"""Slash command handler for /herdr."""

from __future__ import annotations

import shlex
from typing import Any

from hermes_herdr.client import HerdrClient

_client = HerdrClient()

_HELP_TEXT = """\
Herdr Multi-Machine Commands:
  /herdr machines             - List configured local and remote SSH machines
  /herdr agents [machine]     - List active agents across machines (or on a specific machine)
  /herdr status [machine]     - Show server status for local or a remote machine
  /herdr spawn <prompt>       - Spawn an agent session in Herdr (default: local)
  /herdr help                 - Show this help message
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

    if sub in {"machines", "list"}:
        machines = _client.list_machines()
        if not machines:
            return "No Herdr machines found."

        lines = ["Connected Herdr Machines:"]
        for m in machines:
            def_mark = " (default)" if m.get("is_default") else ""
            status_mark = "🟢 enabled" if m.get("enabled", True) else "⚪ disabled"
            label = m.get("label", m.get("id"))
            target = m.get("target", "local")
            lines.append(f"  • {label}{def_mark}: {target} [{status_mark}]")
        return "\n".join(lines)

    if sub == "agents":
        machine = tokens[1] if len(tokens) > 1 else "all"
        agents = _client.list_agents(machine=machine)
        if not agents:
            scope = "any machine" if machine == "all" else f"machine '{machine}'"
            return f"No active agents running on {scope}."

        lines = [f"Active Agents in Network ({machine}):"]
        for a in agents:
            m = a.get("machine", "local")
            kind = a.get("agent_type", a.get("agent", "agent"))
            status = a.get("agent_status", "unknown")
            title = a.get("title", "")
            ws = a.get("workspace_label") or a.get("workspace_id", "")
            ws_str = f" [{ws}]" if ws else ""
            cwd = a.get("cwd", "")
            pane = a.get("pane_id", "?")
            lines.append(f"  • [{m}]{ws_str} {kind} ({status}): \"{title}\" @ {cwd} (pane {pane})")
        return "\n".join(lines)

    if sub == "status":
        machine = tokens[1] if len(tokens) > 1 else "local"
        res = _client.get_server_status(machine=machine)
        if not res.get("online"):
            return f"❌ Failed to reach Herdr server on '{machine}': {res.get('error', 'offline')}"

        return (
            f"✅ Herdr Server ({machine}):\n"
            f"   Status: {res.get('status')}\n"
            f"   Version: {res.get('version', 'unknown')}\n"
            f"   Socket: {res.get('socket', 'unknown')}"
        )

    if sub == "spawn":
        prompt = args[5:].strip()
        if not prompt:
            return "Usage: /herdr spawn <task instructions or prompt>"

        res = _client.spawn_agent(prompt=prompt)
        if not res.get("ok"):
            return f"❌ Spawn failed: {res.get('error')}"

        return (
            f"🚀 Spawned {res.get('kind', 'agent')} session '{res.get('name')}' on {res.get('machine')}:\n"
            f"   Pane ID: {res.get('pane_id')}\n"
            f"   Prompt: {prompt[:60]}..."
        )

    return f"Unknown subcommand '{sub}'.\n\n{_HELP_TEXT}"
