"""Unit tests for Hermes plugin implementation with CLI-backed HerdrClient."""

import json
from pathlib import Path
from unittest.mock import MagicMock, patch
import subprocess

import pytest
import yaml

from hermes_herdr import register
from hermes_herdr.client import HerdrClient, HerdrCLIError
from hermes_herdr.commands import handle_herdr_command
from hermes_herdr.tools import (
    handle_herdr_list_agents,
    handle_herdr_list_machines,
    handle_herdr_node_status,
    handle_herdr_prompt_agent,
    handle_herdr_read_agent,
    handle_herdr_spawn_agent,
)


def test_plugin_yaml_manifest():
    """Verify plugin.yaml exists, is valid YAML, and contains expected metadata."""
    manifest_path = Path(__file__).resolve().parent.parent / "plugin.yaml"
    assert manifest_path.exists(), "plugin.yaml must exist at repo root"

    with open(manifest_path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)

    assert data["name"] == "herdr-agent-gateway"
    assert "version" in data
    assert "provides_tools" in data
    assert "herdr_spawn_agent" in data["provides_tools"]
    assert "herdr_list_machines" in data["provides_tools"]
    assert "herdr_list_agents" in data["provides_tools"]
    assert "herdr_prompt_agent" in data["provides_tools"]
    assert "herdr_read_agent" in data["provides_tools"]
    assert "herdr_node_status" in data["provides_tools"]
    assert "provides_skills" in data
    assert "spawn_herdr_agent" in data["provides_skills"]
    assert "provides_commands" in data
    assert "herdr" in data["provides_commands"]


def test_plugin_register_lifecycle():
    """Verify register(ctx) registers tools, skill, and command."""
    mock_ctx = MagicMock()
    register(mock_ctx)

    # 6 tools registered
    assert mock_ctx.register_tool.call_count == 6
    registered_tool_names = [call.kwargs["name"] for call in mock_ctx.register_tool.call_args_list]
    assert "herdr_spawn_agent" in registered_tool_names
    assert "herdr_list_machines" in registered_tool_names
    assert "herdr_list_agents" in registered_tool_names
    assert "herdr_prompt_agent" in registered_tool_names
    assert "herdr_read_agent" in registered_tool_names
    assert "herdr_node_status" in registered_tool_names

    # Skill registered
    mock_ctx.register_skill.assert_called_once()
    assert mock_ctx.register_skill.call_args.kwargs["name"] == "spawn_herdr_agent"

    # Command registered
    mock_ctx.register_command.assert_called_once()
    assert mock_ctx.register_command.call_args.args[0] == "herdr"


def test_client_resolve_bin(monkeypatch):
    """Verify binary resolution checks env, which, and standard paths."""
    client = HerdrClient()

    # If HERDR_BIN_PATH is set
    monkeypatch.setenv("HERDR_BIN_PATH", "/custom/bin/herdr")
    with patch("os.path.exists", return_value=True):
        assert client.resolve_herdr_bin() == "/custom/bin/herdr"

    # If not set, checks which
    monkeypatch.delenv("HERDR_BIN_PATH", raising=False)
    with patch("shutil.which", return_value="/usr/bin/herdr"):
        assert client.resolve_herdr_bin() == "/usr/bin/herdr"

    # If not found anywhere, raises FileNotFoundError
    with patch("shutil.which", return_value=None), patch("os.path.exists", return_value=False), patch("pathlib.Path.exists", return_value=False):
        with pytest.raises(FileNotFoundError, match="The 'herdr' executable was not found"):
            client.resolve_herdr_bin()


@patch.object(HerdrClient, "run_cmd")
def test_client_list_machines(mock_run):
    """Verify HerdrClient lists local and remote machines."""
    mock_run.return_value = subprocess.CompletedProcess(
        args=["herdr", "machine", "list", "--json"],
        returncode=0,
        stdout=json.dumps([
            {"id": "m1", "label": "server1", "target": "user@server1.local", "enabled": True},
            {"id": "m2", "label": "predator", "target": "user@predator.local", "enabled": True},
        ]),
    )

    client = HerdrClient(herdr_bin="/bin/herdr")
    machines = client.list_machines()

    assert len(machines) == 3
    assert machines[0]["id"] == "local"
    assert machines[0]["is_default"] is True
    assert machines[1]["label"] == "server1"
    assert machines[2]["label"] == "predator"


@patch.object(HerdrClient, "run_cmd")
def test_client_list_agents(mock_run):
    """Verify HerdrClient aggregates agents across machines."""
    def fake_run(args, machine=None, **kwargs):
        if "machine" in args and "list" in args:
            return subprocess.CompletedProcess(
                args=[], returncode=0,
                stdout=json.dumps([{"id": "m1", "label": "server1", "target": "user@server1.local", "enabled": True}])
            )
        if "workspace" in args:
            return subprocess.CompletedProcess(
                args=[], returncode=0,
                stdout=json.dumps({"result": {"workspaces": [{"workspace_id": "w0", "label": "main"}]}})
            )
        if "agent" in args and "list" in args:
            if machine == "server1":
                return subprocess.CompletedProcess(
                    args=[], returncode=0,
                    stdout=json.dumps({"result": {"agents": [{"agent": "claude", "pane_id": "w1:p1", "workspace_id": "w0", "agent_status": "running", "cwd": "/srv"}]}})
                )
            return subprocess.CompletedProcess(
                args=[], returncode=0,
                stdout=json.dumps({"result": {"agents": [{"agent": "pi", "pane_id": "w0:p1", "workspace_id": "w0", "agent_status": "idle", "cwd": "/home"}]}})
            )
        return subprocess.CompletedProcess(args=[], returncode=0, stdout="{}")

    mock_run.side_effect = fake_run

    client = HerdrClient(herdr_bin="/bin/herdr")
    agents = client.list_agents(machine="all")

    assert len(agents) == 2
    assert agents[0]["agent"] == "pi"
    assert agents[0]["machine"] == "local"
    assert agents[0]["workspace_label"] == "main"
    assert agents[1]["agent"] == "claude"
    assert agents[1]["machine"] == "server1"


@patch.object(HerdrClient, "run_cmd")
def test_client_spawn_agent(mock_run):
    """Verify HerdrClient spawns pane, starts agent, and prompts."""
    mock_run.side_effect = [
        subprocess.CompletedProcess(
            args=[], returncode=0,
            stdout=json.dumps({"result": {"pane_id": "w0:p3"}})
        ),
        subprocess.CompletedProcess(args=[], returncode=0, stdout="started"),
        subprocess.CompletedProcess(args=[], returncode=0, stdout="prompt sent"),
    ]

    client = HerdrClient(herdr_bin="/bin/herdr")
    res = client.spawn_agent(
        prompt="Fix the bug",
        kind="claude",
        machine="server1",
        split_direction="right",
    )

    assert res["ok"] is True
    assert res["pane_id"] == "w0:p3"
    assert res["kind"] == "claude"
    assert res["machine"] == "server1"


@patch("hermes_herdr.tools._client")
def test_tool_handlers(mock_client):
    """Verify tool wrappers invoke client methods and return JSON."""
    mock_client.list_machines.return_value = [{"id": "local", "label": "local"}]
    mock_client.list_agents.return_value = [{"agent": "claude", "pane_id": "w0:p1"}]
    mock_client.spawn_agent.return_value = {"ok": True, "pane_id": "w0:p2"}
    mock_client.prompt_agent.return_value = {"ok": True, "output": "ok"}
    mock_client.read_agent.return_value = {"ok": True, "content": "agent output"}
    mock_client.get_server_status.return_value = {"online": True, "version": "0.9.1"}

    out_machines = handle_herdr_list_machines({})
    assert "local" in out_machines

    out_agents = handle_herdr_list_agents({"machine": "all"})
    assert "claude" in out_agents

    out_spawn = handle_herdr_spawn_agent({"prompt": "test"})
    assert "w0:p2" in out_spawn

    out_prompt = handle_herdr_prompt_agent({"target": "agent-1", "prompt": "continue"})
    assert "ok" in out_prompt

    out_read = handle_herdr_read_agent({"target": "agent-1"})
    assert "agent output" in out_read

    out_status = handle_herdr_node_status({"machine": "local"})
    assert "0.9.1" in out_status


@patch("hermes_herdr.commands._client")
def test_commands(mock_client):
    """Verify /herdr slash command handler."""
    mock_client.list_machines.return_value = [{"label": "server1", "target": "user@server1", "enabled": True}]
    mock_client.list_agents.return_value = [{"agent": "pi", "machine": "local", "pane_id": "w0:p1", "agent_status": "idle"}]
    mock_client.get_server_status.return_value = {"online": True, "status": "running", "version": "0.9.1"}
    mock_client.spawn_agent.return_value = {"ok": True, "kind": "claude", "name": "a1", "machine": "local", "pane_id": "w0:p2"}

    # Help
    assert "Herdr Multi-Machine Commands" in handle_herdr_command("help")

    # Machines
    out_m = handle_herdr_command("machines")
    assert "server1" in out_m

    # Agents
    out_a = handle_herdr_command("agents")
    assert "w0:p1" in out_a

    # Status
    out_s = handle_herdr_command("status")
    assert "running" in out_s

    # Spawn
    out_sp = handle_herdr_command("spawn write unit tests")
    assert "Spawned" in out_sp
