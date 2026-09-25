"""CLI client for Herdr multiplexer and remote SSH machines.

Interacts directly with the Herdr CLI over its local socket API and OpenSSH
machine forwarding bridge (herdr --machine <target>).
"""

from __future__ import annotations

import json
import logging
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

STANDARD_HERDR_PATHS = [
    Path.home() / ".local" / "bin" / "herdr",
    Path.home() / ".nix-profile" / "bin" / "herdr",
    Path("/usr/local/bin/herdr"),
    Path("/run/current-system/sw/bin/herdr"),
]


class HerdrCLIError(Exception):
    """Exception raised when a Herdr CLI command fails."""


class HerdrClient:
    """Client wrapping Herdr CLI for multi-machine agent coordination."""

    def __init__(self, herdr_bin: Optional[str] = None):
        self._explicit_bin = herdr_bin

    def resolve_herdr_bin(self) -> str:
        """Find the herdr binary on the system or return a helpful error."""
        if self._explicit_bin:
            return self._explicit_bin

        if "HERDR_BIN_PATH" in os.environ and os.path.exists(os.environ["HERDR_BIN_PATH"]):
            return os.environ["HERDR_BIN_PATH"]

        found = shutil.which("herdr")
        if found:
            return found

        for candidate in STANDARD_HERDR_PATHS:
            if candidate.exists() and os.access(candidate, os.X_OK):
                return str(candidate)

        raise FileNotFoundError(
            "The 'herdr' executable was not found on PATH or standard locations.\n"
            "To install Herdr:\n"
            "  • Linux/macOS: curl -fsSL https://herdr.dev/install | sh\n"
            "  • NixOS: add pkgs.herdr to system packages or hermesContainerTools\n"
            "Or set the HERDR_BIN_PATH environment variable."
        )

    def run_cmd(self, args: List[str], machine: Optional[str] = None, timeout: int = 15) -> subprocess.CompletedProcess:
        """Execute a herdr command, optionally targeted at a remote machine."""
        bin_path = self.resolve_herdr_bin()
        cmd = [bin_path]
        if machine and machine not in {"local", "localhost"}:
            cmd.extend(["--machine", machine])
        cmd.extend(args)

        try:
            return subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                check=True,
                timeout=timeout,
            )
        except subprocess.CalledProcessError as exc:
            err_msg = (exc.stderr or exc.stdout or str(exc)).strip()
            raise HerdrCLIError(f"Herdr command failed ({' '.join(cmd)}): {err_msg}") from exc
        except subprocess.TimeoutExpired as exc:
            raise HerdrCLIError(f"Herdr command timed out after {timeout}s: {' '.join(cmd)}") from exc

    def list_machines(self) -> List[Dict[str, Any]]:
        """List local and saved SSH machines configured in Herdr."""
        machines: List[Dict[str, Any]] = [
            {
                "id": "local",
                "label": "local",
                "target": "local",
                "session": "default",
                "enabled": True,
                "is_default": True,
            }
        ]

        try:
            res = self.run_cmd(["machine", "list", "--json"], timeout=5)
            remote_machines = json.loads(res.stdout)
            if isinstance(remote_machines, list):
                for m in remote_machines:
                    m["is_default"] = False
                    machines.append(m)
        except Exception as exc:
            logger.warning("Failed to query Herdr saved machines: %s", exc)

        return machines

    def list_agents(self, machine: str = "all") -> List[Dict[str, Any]]:
        """List active agents across machines or for a specific machine."""
        if machine and machine != "all":
            return self._list_agents_for_machine(machine)

        # Aggregate across local + all enabled remote machines
        all_agents: List[Dict[str, Any]] = []
        machines = self.list_machines()
        for m in machines:
            if not m.get("enabled", True):
                continue
            m_label = m.get("label", m.get("id", "unknown"))
            try:
                agents = self._list_agents_for_machine(m_label)
                all_agents.extend(agents)
            except Exception as exc:
                logger.warning("Failed to query agents on machine '%s': %s", m_label, exc)

        return all_agents

    def _get_workspace_map(self, machine: Optional[str] = None) -> Dict[str, str]:
        """Map workspace_id -> label for a machine."""
        target = None if machine in {None, "local", "localhost"} else machine
        try:
            res = self.run_cmd(["workspace", "list"], machine=target, timeout=5)
            data = json.loads(res.stdout)
            workspaces = data.get("result", {}).get("workspaces", [])
            return {
                w.get("workspace_id"): w.get("label") or f"Workspace {w.get('number', '')}"
                for w in workspaces if w.get("workspace_id")
            }
        except Exception:
            return {}

    def _list_agents_for_machine(self, machine: str) -> List[Dict[str, Any]]:
        """List active agents for a single machine with enriched metadata."""
        target_machine = None if machine in {"local", "localhost"} else machine
        ws_map = self._get_workspace_map(target_machine)
        res = self.run_cmd(["agent", "list"], machine=target_machine, timeout=10)
        data = json.loads(res.stdout)
        agents: List[Dict[str, Any]] = []

        raw_list = data.get("result", {}).get("agents", []) if isinstance(data, dict) else []
        for a in raw_list:
            ws_id = a.get("workspace_id", "")
            raw_title = a.get("terminal_title_stripped") or a.get("terminal_title") or ""
            # Strip symbol prefixes
            clean_title = raw_title.lstrip("π*•- ").strip()
            cwd = a.get("cwd") or a.get("foreground_cwd") or ""

            # Derive topic/description
            parts = [p.strip() for p in raw_title.split("-") if p.strip() and p.strip() not in {"π", "claude", "codex", "opencode", "hermes"}]
            desc = parts[0] if parts else (Path(cwd).name if cwd else "")

            enriched = {
                "machine": machine,
                "agent_type": a.get("agent", "unknown"),
                "agent_status": a.get("agent_status", "unknown"),
                "title": clean_title or "(no title)",
                "description": desc,
                "cwd": cwd,
                "workspace_id": ws_id,
                "workspace_label": ws_map.get(ws_id, ws_id),
                "pane_id": a.get("pane_id", ""),
                "tab_id": a.get("tab_id", ""),
                "focused": a.get("focused", False),
                "session": a.get("agent_session"),
                "agent": a.get("agent", "unknown"),
            }
            agents.append(enriched)
        return agents

    def get_server_status(self, machine: Optional[str] = None) -> Dict[str, Any]:
        """Query server status and health."""
        target = None if machine in {None, "local", "localhost"} else machine
        try:
            res = self.run_cmd(["status", "server"], machine=target, timeout=5)
            # Parse key-value lines
            status_dict: Dict[str, Any] = {"machine": machine or "local", "raw": res.stdout.strip()}
            for line in res.stdout.splitlines():
                if ":" in line:
                    k, v = line.split(":", 1)
                    status_dict[k.strip()] = v.strip()
            status_dict["online"] = status_dict.get("status") == "running"
            return status_dict
        except Exception as exc:
            return {
                "machine": machine or "local",
                "online": False,
                "error": str(exc),
            }

    def spawn_agent(
        self,
        prompt: str,
        name: Optional[str] = None,
        kind: str = "claude",
        machine: Optional[str] = None,
        pane_id: Optional[str] = None,
        split_direction: str = "right",
        cwd: Optional[str] = None,
        wait: bool = False,
    ) -> Dict[str, Any]:
        """Spawn a pane split and start an agent, optionally prompting it."""
        target_machine = None if machine in {None, "local", "localhost"} else machine

        # 1. Ensure pane exists or split one
        active_pane = pane_id
        if not active_pane:
            split_args = ["pane", "split", "--direction", split_direction]
            if cwd:
                split_args.extend(["--cwd", cwd])
            res = self.run_cmd(split_args, machine=target_machine, timeout=10)
            # stdout typically contains JSON or pane ID string
            active_pane = res.stdout.strip()
            # If stdout is JSON like {"id":"cli:pane:split","result":{"pane_id":"w0:p2"}}
            try:
                split_json = json.loads(res.stdout)
                if "result" in split_json and "pane_id" in split_json["result"]:
                    active_pane = split_json["result"]["pane_id"]
            except Exception:
                pass

        session_name = name or f"agent-{os.urandom(3).hex()}"

        # 2. Start agent in pane
        start_args = ["agent", "start", session_name, "--kind", kind, "--pane", active_pane]
        self.run_cmd(start_args, machine=target_machine, timeout=30)

        # 3. Prompt agent if prompt provided
        prompt_res = ""
        if prompt:
            prompt_args = ["agent", "prompt", session_name, prompt]
            if wait:
                prompt_args.append("--wait")
            pres = self.run_cmd(prompt_args, machine=target_machine, timeout=300 if wait else 15)
            prompt_res = pres.stdout.strip()

        return {
            "ok": True,
            "machine": machine or "local",
            "name": session_name,
            "kind": kind,
            "pane_id": active_pane,
            "prompt_result": prompt_res,
        }

    def prompt_agent(
        self,
        target: str,
        prompt: str,
        machine: Optional[str] = None,
        wait: bool = False,
    ) -> Dict[str, Any]:
        """Inject prompt into an existing agent."""
        target_machine = None if machine in {None, "local", "localhost"} else machine
        args = ["agent", "prompt", target, prompt]
        if wait:
            args.append("--wait")
        res = self.run_cmd(args, machine=target_machine, timeout=300 if wait else 15)
        return {
            "ok": True,
            "target": target,
            "machine": machine or "local",
            "output": res.stdout.strip(),
        }

    def read_agent(
        self,
        target: str,
        machine: Optional[str] = None,
        lines: int = 100,
        source: str = "recent-unwrapped",
    ) -> Dict[str, Any]:
        """Read output lines from an agent."""
        target_machine = None if machine in {None, "local", "localhost"} else machine
        args = ["agent", "read", target, "--lines", str(lines), "--source", source]
        res = self.run_cmd(args, machine=target_machine, timeout=10)
        return {
            "ok": True,
            "target": target,
            "machine": machine or "local",
            "content": res.stdout.strip(),
        }
