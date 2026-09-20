"""Slash command handler for /herdr."""

from __future__ import annotations

import shlex
from typing import Any

from hermes_herdr.client import HerdrGatewayClient

_client = HerdrGatewayClient()

_HELP_TEXT = """\
Herdr Agent Gateway Commands:
  /herdr list               - List configured Herdr nodes
  /herdr status [node]      - Show status and capacity for a node
  /herdr spawn <prompt>     - Spawn an agent session in Herdr (default node)
  /herdr help               - Show this help message
"""


def handle_herdr_command(args: str = "", **kwargs: Any) -> str:
    """Process /herdr <subcommand> invocations."""
    del kwargs
    args = (args or "").strip()
    if not args or args in {"help", "-h", "--help"}:
        return _HELP_TEXT

    try:
        tokens = shlex.split(args)
    except ValueError:
        tokens = args.split()

    sub = tokens[0].lower()

    if sub == "list":
        nodes = _client.list_nodes(check_health=True)
        if not nodes:
            return "No Herdr nodes configured. See ~/.config/herdr_nodes.json."

        lines = ["Configured Herdr Nodes:"]
        for n in nodes:
            def_mark = " (default)" if n.get("is_default") else ""
            status_mark = "🟢 online" if n.get("online") else "🔴 unreachable"
            panes = f" — {n.get('active_panes', 0)}/{n.get('max_panes', '?')} panes" if n.get("online") else ""
            lines.append(f"  • {n['name']}{def_mark}: {n['url']} [{status_mark}{panes}]")
        return "\n".join(lines)

    if sub == "status":
        node_name = tokens[1] if len(tokens) > 1 else None
        res = _client.get_status(node_name=node_name)
        if not res.get("ok"):
            return f"❌ Failed to reach Herdr node '{node_name or 'default'}': {res.get('error')}"

        return (
            f"✅ Herdr Gateway: {res.get('node')} ({res.get('url')})\n"
            f"   Version: {res.get('version', 'unknown')}\n"
            f"   Active Panes: {res.get('active_panes', 0)}/{res.get('max_panes', 'unlimited')}\n"
            f"   Allowed Kinds: {', '.join(res.get('allowed_kinds', []))}"
        )

    if sub == "spawn":
        prompt = args[5:].strip()
        if not prompt:
            return "Usage: /herdr spawn <task instructions or prompt>"

        res = _client.spawn_agent(prompt=prompt)
        if not res.get("ok"):
            return f"❌ Spawn failed: {res.get('error')}"

        return (
            f"🚀 Spawned {res.get('kind', 'agent')} session '{res.get('name')}' on {res.get('node')}:\n"
            f"   Pane ID: {res.get('pane_id')}\n"
            f"   Workspace: {res.get('workspace')}\n"
            f"   Prompt: {prompt[:60]}..."
        )

    return f"Unknown subcommand '{sub}'.\n\n{_HELP_TEXT}"
