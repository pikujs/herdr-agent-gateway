"""Unit tests for Hermes plugin implementation."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch
import urllib.error

import pytest
import yaml

from hermes_herdr import register
from hermes_herdr.client import HerdrGatewayClient
from hermes_herdr.commands import handle_herdr_command
from hermes_herdr.tools import (
    handle_herdr_list_nodes,
    handle_herdr_node_status,
    handle_herdr_spawn_agent,
)


def test_plugin_yaml_manifest():
    """Verify plugin.yaml exists, is valid YAML, and contains expected metadata."""
    manifest_path = Path(__file__).resolve().parent.parent / "plugin.yaml"
    assert manifest_path.exists(), "plugin.yaml must exist at repo root"

    with open(manifest_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    assert data["name"] == "herdr"
    assert "version" in data
    assert "provides_tools" in data
    assert "herdr_spawn_agent" in data["provides_tools"]
    assert "herdr_list_nodes" in data["provides_tools"]
    assert "herdr_node_status" in data["provides_tools"]
    assert "provides_skills" in data
    assert "spawn_herdr_agent" in data["provides_skills"]
    assert "provides_commands" in data
    assert "herdr" in data["provides_commands"]


def test_plugin_register_lifecycle():
    """Verify register(ctx) registers tools, skill, and command."""
    mock_ctx = MagicMock()
    register(mock_ctx)

    # 3 tools registered
    assert mock_ctx.register_tool.call_count == 3
    registered_tool_names = [call.kwargs["name"] for call in mock_ctx.register_tool.call_args_list]
    assert "herdr_spawn_agent" in registered_tool_names
    assert "herdr_list_nodes" in registered_tool_names
    assert "herdr_node_status" in registered_tool_names

    # Skill registered
    mock_ctx.register_skill.assert_called_once()
    assert mock_ctx.register_skill.call_args.kwargs["name"] == "spawn_herdr_agent"

    # Command registered
    mock_ctx.register_command.assert_called_once()
    assert mock_ctx.register_command.call_args.args[0] == "herdr"


def test_client_fallback_config(tmp_path):
    """Verify HerdrGatewayClient falls back to env/defaults if config file missing."""
    non_existent = tmp_path / "missing_nodes.json"
    client = HerdrGatewayClient(config_path=non_existent)

    config = client.load_config()
    assert config["default_node"] == "localhost"
    assert "localhost" in config["nodes"]

    name, url, token = client.resolve_node()
    assert name == "localhost"
    assert url == "http://127.0.0.1:9480"


def test_client_custom_config(tmp_path):
    """Verify HerdrGatewayClient correctly parses custom nodes config."""
    config_file = tmp_path / "herdr_nodes.json"
    config_data = {
        "default_node": "server1",
        "nodes": {
            "server1": {"url": "http://192.168.88.4:9480", "token": "secret-tok-1"},
            "pikujs-mini": {"url": "http://192.168.88.15:9480", "token": "secret-tok-2"},
        },
    }
    config_file.write_text(json.dumps(config_data), encoding="utf-8")

    client = HerdrGatewayClient(config_path=config_file)

    name, url, token = client.resolve_node()
    assert name == "server1"
    assert url == "http://192.168.88.4:9480"
    assert token == "secret-tok-1"

    name, url, token = client.resolve_node("pikujs-mini")
    assert name == "pikujs-mini"
    assert url == "http://192.168.88.15:9480"
    assert token == "secret-tok-2"

    with pytest.raises(ValueError, match="is not configured"):
        client.resolve_node("unknown-node")


@patch("urllib.request.urlopen")
def test_client_spawn_agent_success(mock_urlopen, tmp_path):
    """Verify spawn_agent sends proper HTTP POST request."""
    config_file = tmp_path / "herdr_nodes.json"
    config_data = {
        "default_node": "server1",
        "nodes": {
            "server1": {"url": "http://192.168.88.4:9480", "token": "test-token"},
        },
    }
    config_file.write_text(json.dumps(config_data), encoding="utf-8")

    mock_resp = MagicMock()
    mock_resp.getcode.return_value = 200
    mock_resp.read.return_value = json.dumps({
        "ok": True,
        "pane_id": "pane-123",
        "name": "session-1",
        "workspace": "default",
        "kind": "claude",
    }).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp
    mock_urlopen.return_value = mock_resp

    client = HerdrGatewayClient(config_path=config_file)
    res = client.spawn_agent(
        prompt="Fix the bug",
        node_name="server1",
        kind="claude",
        pane_direction="right",
    )

    assert res["ok"] is True
    assert res["pane_id"] == "pane-123"
    assert res["node"] == "server1"

    req = mock_urlopen.call_args.args[0]
    assert req.method == "POST"
    assert req.full_url == "http://192.168.88.4:9480/spawn"
    assert req.headers["Authorization"] == "Bearer test-token"
    assert req.headers["Content-type"] == "application/json"
    sent_payload = json.loads(req.data.decode("utf-8"))
    assert sent_payload["prompt"] == "Fix the bug"
    assert sent_payload["kind"] == "claude"


def test_tool_spawn_agent_validation():
    """Verify tool handles missing prompt gracefully."""
    raw = handle_herdr_spawn_agent({})
    res = json.loads(raw)
    assert res["ok"] is False
    assert "Missing required argument" in res["error"]


def test_slash_command_help():
    """Verify /herdr help output."""
    out = handle_herdr_command("help")
    assert "/herdr list" in out
    assert "/herdr spawn" in out
    assert "/herdr status" in out


def test_slash_command_unknown():
    """Verify unknown subcommand returns guidance."""
    out = handle_herdr_command("foobar")
    assert "Unknown subcommand 'foobar'" in out


@patch("urllib.request.urlopen")
def test_client_status_and_list_nodes(mock_urlopen, tmp_path):
    """Verify get_status and list_nodes with health checking."""
    config_file = tmp_path / "herdr_nodes.json"
    config_data = {
        "default_node": "localhost",
        "nodes": {
            "localhost": {"url": "http://127.0.0.1:9480", "token": "test-token"},
        },
    }
    config_file.write_text(json.dumps(config_data), encoding="utf-8")

    mock_resp = MagicMock()
    mock_resp.getcode.return_value = 200
    mock_resp.read.return_value = json.dumps({
        "ok": True,
        "version": "0.1.0",
        "active_panes": 2,
        "max_panes": 8,
        "allowed_kinds": ["claude", "hermes"],
    }).encode("utf-8")
    mock_resp.__enter__.return_value = mock_resp
    mock_urlopen.return_value = mock_resp

    client = HerdrGatewayClient(config_path=config_file)
    status = client.get_status("localhost")
    assert status["ok"] is True
    assert status["version"] == "0.1.0"
    assert status["active_panes"] == 2

    nodes = client.list_nodes(check_health=True)
    assert len(nodes) == 1
    assert nodes[0]["name"] == "localhost"
    assert nodes[0]["online"] is True
    assert nodes[0]["active_panes"] == 2


@patch("urllib.request.urlopen")
def test_client_http_error(mock_urlopen, tmp_path):
    """Verify client handles HTTP errors properly."""
    config_file = tmp_path / "herdr_nodes.json"
    config_data = {
        "default_node": "localhost",
        "nodes": {
            "localhost": {"url": "http://127.0.0.1:9480", "token": "test-token"},
        },
    }
    config_file.write_text(json.dumps(config_data), encoding="utf-8")

    error_fp = MagicMock()
    error_fp.read.return_value = json.dumps({"error": "Unauthorized"}).encode("utf-8")
    mock_urlopen.side_effect = urllib.error.HTTPError(
        url="http://127.0.0.1:9480/status",
        code=401,
        msg="Unauthorized",
        hdrs={},
        fp=error_fp,
    )

    client = HerdrGatewayClient(config_path=config_file)
    res = client.get_status("localhost")
    assert res["ok"] is False
    assert res["status"] == 401
    assert "401" in res["error"]


def test_client_endpoint_and_env_token(tmp_path, monkeypatch):
    """Verify client parses endpoint and resolves env:VAR_NAME tokens."""
    monkeypatch.setenv("HERDR_GATEWAY_TOKEN", "resolved-secret-token")
    config_file = tmp_path / "herdr_nodes.json"
    config_data = {
        "default_node": "server1",
        "nodes": {
            "server1": {
                "endpoint": "http://192.168.88.4:9480",
                "auth_token": "env:HERDR_GATEWAY_TOKEN",
            },
        },
    }
    config_file.write_text(json.dumps(config_data), encoding="utf-8")

    client = HerdrGatewayClient(config_path=config_file)
    name, url, token = client.resolve_node("server1")
    assert name == "server1"
    assert url == "http://192.168.88.4:9480"
    assert token == "resolved-secret-token"
