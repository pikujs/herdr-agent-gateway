#!/usr/bin/env python3
"""Multi-Machine Agent Overview for Herdr.

Queries the local Herdr daemon and all configured SSH machines to list
active coding agents across the entire cluster with rich metadata:
machine, agent type, lifecycle status, title, workspace label, directory (CWD),
and optional description.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict, List, Optional

STANDARD_HERDR_PATHS = [
    Path.home() / ".local" / "bin" / "herdr",
    Path.home() / ".nix-profile" / "bin" / "herdr",
    Path("/usr/local/bin/herdr"),
    Path("/run/current-system/sw/bin/herdr"),
]


def resolve_herdr() -> str:
    """Find herdr binary."""
    if "HERDR_BIN_PATH" in os.environ and os.path.exists(os.environ["HERDR_BIN_PATH"]):
        return os.environ["HERDR_BIN_PATH"]
    found = shutil.which("herdr")
    if found:
        return found
    for p in STANDARD_HERDR_PATHS:
        if p.exists() and os.access(p, os.X_OK):
            return str(p)
    return "herdr"


def run_herdr(args: List[str], machine: Optional[str] = None) -> str:
    """Run herdr CLI command."""
    h_bin = resolve_herdr()
    cmd = [h_bin]
    if machine and machine not in {"local", "localhost"}:
        cmd.extend(["--machine", machine])
    cmd.extend(args)
    try:
        res = subprocess.run(cmd, capture_output=True, text=True, check=True, timeout=10)
        return res.stdout
    except Exception:
        return ""


def get_machines() -> List[Dict[str, Any]]:
    """Get list of machines."""
    machines = [{"id": "local", "label": "local", "enabled": True}]
    raw = run_herdr(["machine", "list", "--json"])
    if raw:
        try:
            remotes = json.loads(raw)
            if isinstance(remotes, list):
                machines.extend(remotes)
        except Exception:
            pass
    return machines


def get_workspace_map(machine: Optional[str] = None) -> Dict[str, str]:
    """Map workspace_id -> label for a machine."""
    ws_map: Dict[str, str] = {}
    raw = run_herdr(["workspace", "list"], machine=machine)
    if raw:
        try:
            data = json.loads(raw)
            workspaces = data.get("result", {}).get("workspaces", [])
            for w in workspaces:
                ws_id = w.get("workspace_id")
                label = w.get("label") or f"Workspace {w.get('number', '')}"
                if ws_id:
                    ws_map[ws_id] = label
        except Exception:
            pass
    return ws_map


def clean_title(title: str) -> str:
    """Strip redundant terminal prefixes from title."""
    t = title.strip()
    # Strip leading shell/symbol prefixes like "π - ", "claude - "
    t = re.sub(r"^[π*•\-]\s*[-–]\s*", "", t)
    return t


def derive_description(agent: Dict[str, Any], title: str, cwd: str) -> str:
    """Derive a friendly task/topic description from session and title."""
    session = agent.get("agent_session", {})
    val = session.get("value", "") if isinstance(session, dict) else ""
    
    # If title has multiple parts e.g. "π - task-name - repo"
    parts = [p.strip() for p in title.split("-") if p.strip() and p.strip() not in {"π", "claude", "codex", "opencode", "hermes"}]
    if parts:
        return parts[0]
    
    # Or fallback to directory basename
    if cwd:
        return Path(cwd).name
    return ""


def get_all_agents() -> List[Dict[str, Any]]:
    """Collect agents with enriched metadata from all enabled machines."""
    all_agents: List[Dict[str, Any]] = []
    machines = get_machines()

    for m in machines:
        if not m.get("enabled", True):
            continue
        m_label = m.get("label", m.get("id"))
        target = None if m_label in {"local", "localhost"} else m_label

        ws_map = get_workspace_map(machine=target)

        raw = run_herdr(["agent", "list"], machine=target)
        if not raw:
            continue
        try:
            data = json.loads(raw)
            agents = data.get("result", {}).get("agents", [])
            for a in agents:
                ws_id = a.get("workspace_id", "")
                ws_label = ws_map.get(ws_id, ws_id)
                raw_title = a.get("terminal_title_stripped") or a.get("terminal_title") or ""
                title = clean_title(raw_title)
                cwd = a.get("cwd") or a.get("foreground_cwd") or ""
                desc = derive_description(a, raw_title, cwd)

                enriched = {
                    "machine": m_label,
                    "agent_type": a.get("agent", "unknown"),
                    "status": a.get("agent_status", "unknown"),
                    "title": title or "(no title)",
                    "description": desc,
                    "cwd": cwd,
                    "workspace_id": ws_id,
                    "workspace_label": ws_label,
                    "pane_id": a.get("pane_id", ""),
                    "tab_id": a.get("tab_id", ""),
                    "focused": a.get("focused", False),
                    "session": a.get("agent_session"),
                }
                all_agents.append(enriched)
        except Exception:
            continue

    return all_agents


def render_table(agents: List[Dict[str, Any]], detailed: bool = False) -> None:
    """Render colorized terminal overview table."""
    CYAN = "\033[36m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    MAGENTA = "\033[35m"
    BLUE = "\033[34m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    RESET = "\033[0m"

    print(f"\n{BOLD}{CYAN}══ Herdr Multi-Machine Agent Network Overview ══{RESET}\n")

    if not agents:
        print("  No active agents running on any connected machines.\n")
        return

    # Header
    header = f"{'MACHINE':<14} {'AGENT TYPE':<12} {'STATUS':<10} {'WORKSPACE':<16} {'TITLE':<24} {'DIRECTORY (CWD)'}"
    print(f"{BOLD}{header}{RESET}")
    print("─" * 105)

    for a in agents:
        machine = a.get("machine", "local")
        agent_type = a.get("agent_type", "agent")
        status = a.get("status", "unknown")
        ws_display = f"{a.get('workspace_label')} ({a.get('workspace_id')})" if a.get("workspace_id") else a.get("workspace_label", "-")
        title = a.get("title", "")
        cwd = a.get("cwd", "")
        desc = a.get("description", "")

        # Truncate long fields for clean alignment
        ws_str = ws_display[:15]
        title_str = title[:23]

        # Format status with color
        if status == "idle":
            status_str = f"{GREEN}idle{RESET}"
        elif status == "running":
            status_str = f"{YELLOW}running{RESET}"
        else:
            status_str = f"{MAGENTA}{status}{RESET}"

        # Focused marker
        focus_mark = f"{YELLOW}*{RESET}" if a.get("focused") else " "

        line = (
            f"{focus_mark}{CYAN}{machine:<13}{RESET} "
            f"{BLUE}{agent_type:<12}{RESET} "
            f"{status_str:<19} "
            f"{ws_str:<16} "
            f"{title_str:<24} "
            f"{cwd}"
        )
        print(line)

        if detailed and desc and desc != title:
            print(f"   {DIM}└─ topic: {desc} | pane: {a.get('pane_id')}{RESET}")

    print(f"\nTotal agents in network: {len(agents)}\n")


def main() -> None:
    parser = argparse.ArgumentParser(description="Multi-machine Herdr agent network overview")
    parser.add_argument("--format", choices=["table", "json", "cards"], default="table")
    parser.add_argument("--detailed", "-d", action="store_true", help="Show extra details (topic/description, pane)")
    parser.add_argument("--interactive", action="store_true", help="Interactive view")
    args = parser.parse_args()

    agents = get_all_agents()

    if args.format == "json":
        print(json.dumps(agents, indent=2))
        return

    render_table(agents, detailed=(args.detailed or args.format == "cards"))

    if args.interactive:
        try:
            input("Press [Enter] or Ctrl+C to close overview...")
        except (KeyboardInterrupt, EOFError):
            pass


if __name__ == "__main__":
    main()
