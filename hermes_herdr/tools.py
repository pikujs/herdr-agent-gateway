"""Hermes tools for Herdr multiplexer interaction."""

from __future__ import annotations

import json
from typing import Any, Dict

from hermes_herdr.client import HerdrGatewayClient

_client = HerdrGatewayClient()

SPAWN_AGENT_SCHEMA = {
    "name": "herdr_spawn_agent",
    "description": (
        "Request a pane split in the Herdr terminal multiplexer on a local or "
        "remote workstation/server, launching an AI coding agent (Claude Code, "
        "OpenCode, Codex, Cursor, or Hermes) with an execution prompt."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "prompt": {
                "type": "string",
                "description": "Initial task prompt or instructions for the spawned agent.",
            },
            "node": {
                "type": "string",
                "description": (
                    "Target machine profile name from ~/.config/herdr_nodes.json "
                    "(e.g. 'server1', 'pikujs-mini', 'pikujs-predator', or 'localhost'). "
                    "Defaults to the configured default node."
                ),
            },
            "workspace": {
                "type": "string",
                "description": "Target workspace name or directory path in Herdr.",
            },
            "kind": {
                "type": "string",
                "enum": ["claude", "codex", "opencode", "cursor", "hermes"],
                "default": "claude",
                "description": "Agent implementation kind to spawn.",
            },
            "name": {
                "type": "string",
                "description": "Session identifier (1-64 chars, alphanumeric, hyphens, underscores).",
            },
            "pane_direction": {
                "type": "string",
                "enum": ["right", "down", "left", "up"],
                "default": "right",
                "description": "Direction relative to active pane to split.",
            },
            "focus": {
                "type": "boolean",
                "default": False,
                "description": "Whether to transfer user UI focus to the new pane.",
            },
        },
        "required": ["prompt"],
    },
}

LIST_NODES_SCHEMA = {
    "name": "herdr_list_nodes",
    "description": (
        "List all configured Herdr nodes from ~/.config/herdr_nodes.json, "
        "optionally pinging each node's status endpoint to verify connectivity."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "check_health": {
                "type": "boolean",
                "default": False,
                "description": "If true, send a probe request to each node to check if it is online.",
            },
        },
    },
}

NODE_STATUS_SCHEMA = {
    "name": "herdr_node_status",
    "description": (
        "Query the status, version, uptime, and active pane count of a "
        "Herdr Agent Gateway node."
    ),
    "parameters": {
        "type": "object",
        "properties": {
            "node": {
                "type": "string",
                "description": "Node name to query (or 'localhost'). Defaults to the default node.",
            },
        },
    },
}


def handle_herdr_spawn_agent(params: Dict[str, Any], **kwargs) -> str:
    """Handle herdr_spawn_agent tool calls."""
    del kwargs
    prompt = params.get("prompt", "")
    if not prompt:
        return json.dumps({"ok": False, "error": "Missing required argument: 'prompt'"})

    res = _client.spawn_agent(
        prompt=prompt,
        node_name=params.get("node"),
        workspace=params.get("workspace"),
        kind=params.get("kind", "claude"),
        name=params.get("name"),
        pane_direction=params.get("pane_direction", "right"),
        focus=params.get("focus", False),
    )
    return json.dumps(res, indent=2)


def handle_herdr_list_nodes(params: Dict[str, Any], **kwargs) -> str:
    """Handle herdr_list_nodes tool calls."""
    del kwargs
    check_health = params.get("check_health", False)
    nodes = _client.list_nodes(check_health=check_health)
    return json.dumps({"ok": True, "nodes": nodes}, indent=2)


def handle_herdr_node_status(params: Dict[str, Any], **kwargs) -> str:
    """Handle herdr_node_status tool calls."""
    del kwargs
    node = params.get("node")
    res = _client.get_status(node_name=node)
    return json.dumps(res, indent=2)
