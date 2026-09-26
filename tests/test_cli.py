"""Unit tests for herdr-agent-gateway unified CLI."""

from __future__ import annotations

import argparse
import json
import subprocess
from unittest.mock import MagicMock, patch

import pytest

# Import module under test
import sys
from pathlib import Path

# Add bin/ directory to sys.path
bin_dir = Path(__file__).parent.parent / "bin"
sys.path.insert(0, str(bin_dir))

import importlib
import importlib.util
from importlib.machinery import SourceFileLoader
cli_path = bin_dir / "herdr-agent-gateway"
loader = SourceFileLoader("herdr_agent_gateway", str(cli_path))
spec = importlib.util.spec_from_loader("herdr_agent_gateway", loader)
cli = importlib.util.module_from_spec(spec)
loader.exec_module(cli)


def test_resolve_herdr():
    with patch.dict("os.environ", {"HERDR_BIN_PATH": "/custom/path/herdr"}):
        with patch("os.path.exists", return_value=True):
            assert cli.resolve_herdr() == "/custom/path/herdr"


def test_clean_title():
    assert cli.clean_title("π - my-task") == "my-task"
    assert cli.clean_title("• - important job") == "important job"
    assert cli.clean_title("plain task") == "plain task"


def test_derive_description():
    agent_session = {"value": "specific task description"}
    assert cli.derive_description({"agent_session": agent_session}, "title", "/home/repo") == "specific task description"

    assert cli.derive_description({}, "task01 - my-repo", "/home/repo") == "task01"
    assert cli.derive_description({}, "just-title", "/home/pikujs/projects/awesome-repo") == "just-title"


def test_get_machines_mocked():
    mock_remotes = json.dumps([
        {"id": "node1", "label": "server1", "target": "pikujs@server1.local", "enabled": True}
    ])
    with patch.object(cli, "run_herdr") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess([], returncode=0, stdout=mock_remotes, stderr="")
        machines = cli.get_machines(probe=False)
        assert len(machines) == 2
        assert machines[0]["id"] == "local"
        assert machines[1]["label"] == "server1"


def test_get_all_agents_mocked():
    mock_machines = [
        {"id": "local", "label": "local", "enabled": True},
        {"id": "remote1", "label": "server1", "enabled": True},
    ]
    mock_workspaces = json.dumps({
        "result": {
            "workspaces": [{"workspace_id": "w1", "label": "dev-ws"}]
        }
    })
    mock_agents = json.dumps({
        "result": {
            "agents": [
                {
                    "agent": "pi",
                    "agent_status": "idle",
                    "terminal_title": "π - task - repo",
                    "workspace_id": "w1",
                    "cwd": "/home/pikujs/repo",
                    "pane_id": "w1:p1",
                }
            ]
        }
    })

    with patch.object(cli, "get_machines", return_value=mock_machines):
        with patch.object(cli, "run_herdr") as mock_run:
            def side_effect(args, machine=None, timeout=None):
                if args == ["workspace", "list"]:
                    return subprocess.CompletedProcess([], returncode=0, stdout=mock_workspaces, stderr="")
                if args == ["agent", "list"]:
                    return subprocess.CompletedProcess([], returncode=0, stdout=mock_agents, stderr="")
                return subprocess.CompletedProcess([], returncode=0, stdout="", stderr="")

            mock_run.side_effect = side_effect
            agents = cli.get_all_agents()
            assert len(agents) == 2
            assert agents[0]["agent_type"] == "pi"
            assert agents[0]["workspace_label"] == "dev-ws"


def test_handle_spawn_success(capsys):
    split_out = json.dumps({"result": {"pane_id": "w1:p2"}})
    start_out = json.dumps({"result": {"status": "ok"}})

    with patch.object(cli, "run_herdr") as mock_run:
        def side_effect(args, machine=None, timeout=None):
            if "split" in args:
                return subprocess.CompletedProcess([], returncode=0, stdout=split_out, stderr="")
            if "start" in args:
                return subprocess.CompletedProcess([], returncode=0, stdout=start_out, stderr="")
            if "prompt" in args:
                return subprocess.CompletedProcess([], returncode=0, stdout="prompt sent", stderr="")
            return subprocess.CompletedProcess([], returncode=0, stdout="", stderr="")

        mock_run.side_effect = side_effect
        args = argparse.Namespace(
            kind="claude",
            name="test-agent",
            machine="server1",
            cwd="/tmp",
            direction="right",
            prompt="Build feature",
            wait=False,
            json=True,
        )
        code = cli.handle_spawn(args)
        assert code == 0
        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert data["status"] == "success"
        assert data["agent"] == "test-agent"
        assert data["pane_id"] == "w1:p2"
        assert data["machine"] == "server1"


def test_handle_prompt_success(capsys):
    with patch.object(cli, "run_herdr") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess([], returncode=0, stdout="ok", stderr="")
        args = argparse.Namespace(
            target="test-agent",
            prompt="Follow-up instructions",
            machine="local",
            wait=False,
            json=True,
        )
        code = cli.handle_prompt(args)
        assert code == 0
        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert data["status"] == "success"
        assert data["target"] == "test-agent"


def test_handle_read_success(capsys):
    with patch.object(cli, "run_herdr") as mock_run:
        mock_run.return_value = subprocess.CompletedProcess([], returncode=0, stdout="Agent output line 1\nLine 2", stderr="")
        args = argparse.Namespace(
            target="test-agent",
            machine="local",
            lines=50,
            json=True,
        )
        code = cli.handle_read(args)
        assert code == 0
        captured = capsys.readouterr()
        data = json.loads(captured.out)
        assert "Agent output line 1" in data["content"]
