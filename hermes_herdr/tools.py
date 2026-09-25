"""Hermes tools for Herdr multiplexer interaction."""

from __future__ import annotations

import json
from typing import Any, Dict

from hermes_herdr.client import HerdrClient

_client = HerdrClient()

LIST_MACHINES_SCHEMA = {
    "name": "herdr_list_machines",
    "description": (
        "List all local and saved SSH machines configured in Herdr. "
        "Shows machine identifiers, SSH targets, and enabled status."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "check_status": {
                "type": "boolean",
                "default": False,
                "description": "If true, queries the remote server status for each machine.",
            },
        },
    },
}

LIST_AGENTS_SCHEMA = {
    "name": "herdr_list_agents",
    "description": (
        "List active AI coding agents running in Herdr across all connected "
        "machines (or on a specific machine). Returns agent kind, status, "
        "working directory, and pane identifier."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "machine": {
                "type": "string",
                "default": "all",
                "description": (
                    "Machine label or ID (e.g. 'local', 'pikujs-server-1', "
                    "'pikujs-predator', or 'all'). Defaults to 'all'."
                ),
            },
        },
    },
}

SPAWN_AGENT_SCHEMA = {
    "name": "herdr_spawn_agent",
    "description": (
        "Request a pane split in Herdr on the local machine or a remote SSH machine, "
        "launching an AI coding agent (claude, codex, opencode, pi, hermes, cursor) "
        "with an execution prompt."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": "Initial task prompt or instructions for the spawned agent.",
            },
            "machine": {
                "type": "string",
                "default": "local",
                "description": "Target machine label or ID (e.g. 'local', 'pikujs-server-1').",
            },
            "kind": {
                "type": "string",
                "enum": [
                    "claude",
                    "codex",
                    "opencode",
                    "cursor",
                    "hermes",
                    "pi",
                    "gemini",
                    "devin",
                    "agy",
                ],
                "default": "claude",
                "description": "Agent kind/binary to launch.",
            },
            "name": {
                "type": "string",
                "description": "Optional session name for the agent.",
            },
            "pane_direction": {
                "type": "string",
                "enum": ["right", "down", "left", "up"],
                "default": "right",
                "description": "Direction to split the pane.",
            },
            "cwd": {
                "type": "string",
                "description": "Working directory path on the target machine.",
            },
            "wait": {
                "type": "boolean",
                "default": False,
                "description": "Whether to wait for the agent to finish its initial prompt.",
            },
        },
        "required": ["prompt"],
    },
}

PROMPT_AGENT_SCHEMA = {
    "name": "herdr_prompt_agent",
    "description": (
        "Send instructions or prompt text directly to an active agent in Herdr."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "target": {
                "type": "string",
                "description": "Agent name or pane ID (e.g. 'agent-1', 'w0:p2').",
            },
            "prompt": {
                "type": "string",
                "description": "Text prompt to inject.",
            },
            "machine": {
                "type": "string",
                "default": "local",
                "description": "Target machine label or ID.",
            },
            "wait": {
                "type": "boolean",
                "default": False,
                "description": "Block until the agent completes and returns to idle.",
            },
        },
        "required": ["target", "prompt"],
    },
}

READ_AGENT_SCHEMA = {
    "name": "herdr_read_agent",
    "description": (
        "Read recent terminal output from an active agent in Herdr."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "target": {
                "type": "string",
                "description": "Agent name or pane ID.",
            },
            "machine": {
                "type": "string",
                "default": "local",
                "description": "Target machine label or ID.",
            },
            "lines": {
                "type": "integer",
                "default": 100,
                "description": "Number of lines to read.",
            },
            "source": {
                "type": "string",
                "enum": ["recent-unwrapped", "scrollback"],
                "default": "recent-unwrapped",
                "description": "Output buffer source.",
            },
        },
        "required": ["target"],
    },
}

MACHINE_STATUS_SCHEMA = {
    "name": "herdr_node_status",
    "description": "Query server status and health of a local or remote Herdr host.",
    "parameters": {
        "type": "object",
        "properties": {
            "machine": {
                "type": "string",
                "default": "local",
                "description": "Target machine label or ID (or 'local').",
            },
        },
    },
}


def handle_herdr_list_machines(params: Dict[str, Any], **kwargs: Any) -> str:
    """Handle herdr_list_machines tool calls."""
    del kwargs
    check_status = params.get("check_status", False)
    machines = _client.list_machines()

    if check_status:
        for m in machines:
            target = m.get("label", m.get("id"))
            status = _client.get_server_status(target)
            m["status"] = status.get("status", "unknown")
            m["online"] = status.get("online", False)

    return json.dumps(machines, indent=2)


def handle_herdr_list_agents(params: Dict[str, Any], **kwargs: Any) -> str:
    """Handle herdr_list_agents tool calls."""
    del kwargs
    machine = params.get("machine", "all")
    agents = _client.list_agents(machine=machine)
    return json.dumps(agents, indent=2)


def handle_herdr_spawn_agent(params: Dict[str, Any], **kwargs: Any) -> str:
    """Handle herdr_spawn_agent tool calls."""
    del kwargs
    prompt = params["prompt"]
    machine = params.get("machine") or params.get("node") or "local"
    kind = params.get("kind", "claude")
    name = params.get("name")
    split_direction = params.get("pane_direction", "right")
    cwd = params.get("cwd") or params.get("workspace")
    wait = params.get("wait", False)

    res = _client.spawn_agent(
        prompt=prompt,
        name=name,
        kind=kind,
        machine=machine,
        split_direction=split_direction,
        cwd=cwd,
        wait=wait,
    )
    return json.dumps(res, indent=2)


def handle_herdr_prompt_agent(params: Dict[str, Any], **kwargs: Any) -> str:
    """Handle herdr_prompt_agent tool calls."""
    del kwargs
    target = params["target"]
    prompt = params["prompt"]
    machine = params.get("machine", "local")
    wait = params.get("wait", False)

    res = _client.prompt_agent(target=target, prompt=prompt, machine=machine, wait=wait)
    return json.dumps(res, indent=2)


def handle_herdr_read_agent(params: Dict[str, Any], **kwargs: Any) -> str:
    """Handle herdr_read_agent tool calls."""
    del kwargs
    target = params["target"]
    machine = params.get("machine", "local")
    lines = params.get("lines", 100)
    source = params.get("source", "recent-unwrapped")

    res = _client.read_agent(target=target, machine=machine, lines=lines, source=source)
    return json.dumps(res, indent=2)


def handle_herdr_node_status(params: Dict[str, Any], **kwargs: Any) -> str:
    """Handle herdr_node_status tool calls."""
    del kwargs
    machine = params.get("machine") or params.get("node") or "local"
    res = _client.get_server_status(machine=machine)
    return json.dumps(res, indent=2)
