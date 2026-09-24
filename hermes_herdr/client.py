"""Gateway HTTP client for Herdr nodes.

Communicates with Herdr Agent Gateway instances over LAN/VPN or localhost
using standard library urllib.
"""

from __future__ import annotations

import json
import logging
import os
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

DEFAULT_CONFIG_PATH = Path.home() / ".config" / "herdr_nodes.json"
DEFAULT_GATEWAY_URL = "http://127.0.0.1:9480"
DEFAULT_TIMEOUT = 10  # seconds


def _candidate_config_paths() -> List[Path]:
    """Return ordered list of candidate paths to locate herdr_nodes.json."""
    candidates: List[Path] = []
    if "HERDR_NODES_CONFIG" in os.environ:
        candidates.append(Path(os.environ["HERDR_NODES_CONFIG"]))
    if "HERMES_HOME" in os.environ:
        candidates.append(Path(os.environ["HERMES_HOME"]) / "herdr_nodes.json")
    candidates.extend([
        Path.home() / ".config" / "herdr_nodes.json",
        Path.home() / ".config" / "herdr" / "plugins" / "config" / "herdr-remote-gateway" / "herdr_nodes.json",
        Path.home() / ".hermes" / "herdr_nodes.json",
    ])
    return candidates


class HerdrGatewayClient:
    """Client for interacting with local and remote Herdr Agent Gateway endpoints."""

    def __init__(self, config_path: Optional[Path] = None):
        self._explicit_config_path = config_path

    @property
    def config_path(self) -> Path:
        """Resolve the active configuration path."""
        if self._explicit_config_path is not None:
            return self._explicit_config_path
        for candidate in _candidate_config_paths():
            if candidate.exists():
                return candidate
        return DEFAULT_CONFIG_PATH

    def load_config(self) -> Dict[str, Any]:
        """Load node configuration from disk, falling back to environment variables."""
        cfg_path = self.config_path
        if cfg_path.exists():
            try:
                with open(cfg_path, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        return data
            except Exception as exc:
                logger.warning("Failed to read Herdr nodes config at %s: %s", cfg_path, exc)

        # Fallback to environment variables
        env_url = os.environ.get("HERDR_GATEWAY_URL", DEFAULT_GATEWAY_URL)
        env_token = os.environ.get("HERDR_GATEWAY_TOKEN", "")
        return {
            "default_node": "localhost",
            "nodes": {
                "localhost": {
                    "url": env_url,
                    "token": env_token,
                }
            },
        }

    def _resolve_token(self, token_val: str) -> str:
        """Expand env:VAR_NAME tokens from the environment if specified."""
        if token_val.startswith("env:"):
            env_key = token_val[4:].strip()
            return os.environ.get(env_key, "")
        return token_val

    def resolve_node(self, node_name: Optional[str] = None) -> Tuple[str, str, str]:
        """Resolve (name, url, token) for the requested node.

        If node_name is omitted or empty, resolves the configured default node.
        """
        config = self.load_config()
        nodes = config.get("nodes", {})
        default_node = config.get("default_node", "localhost")

        target_name = node_name if node_name else default_node

        if target_name in nodes:
            node_entry = nodes[target_name]
            raw_url = node_entry.get("url") or node_entry.get("endpoint") or DEFAULT_GATEWAY_URL
            url = str(raw_url).rstrip("/")
            raw_token = str(node_entry.get("token") or node_entry.get("auth_token") or "")
            token = self._resolve_token(raw_token)
            return target_name, url, token

        # If node name is 'localhost' or '127.0.0.1', allow automatic fallback
        if target_name in {"localhost", "127.0.0.1", "local"}:
            url = os.environ.get("HERDR_GATEWAY_URL", DEFAULT_GATEWAY_URL).rstrip("/")
            token = os.environ.get("HERDR_GATEWAY_TOKEN", "")
            return target_name, url, token

        raise ValueError(
            f"Herdr node '{target_name}' is not configured in {self.config_path}. "
            f"Available nodes: {', '.join(nodes.keys()) or '(none)'}"
        )

    def _http_request(
        self,
        method: str,
        url: str,
        token: str,
        payload: Optional[Dict[str, Any]] = None,
        timeout: int = DEFAULT_TIMEOUT,
    ) -> Dict[str, Any]:
        """Send an authenticated HTTP request to the gateway."""
        headers = {
            "Accept": "application/json",
            "User-Agent": "hermes-herdr-gateway/0.1.0",
        }
        if token:
            headers["Authorization"] = f"Bearer {token}"

        data_bytes: Optional[bytes] = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data_bytes = json.dumps(payload).encode("utf-8")

        req = urllib.request.Request(
            url=url,
            data=data_bytes,
            headers=headers,
            method=method,
        )

        try:
            with urllib.request.urlopen(req, timeout=timeout) as response:
                status_code = response.getcode()
                raw_body = response.read().decode("utf-8", errors="replace")
                try:
                    parsed = json.loads(raw_body)
                    if isinstance(parsed, dict):
                        return parsed
                    return {"ok": True, "status": status_code, "data": parsed}
                except json.JSONDecodeError:
                    return {"ok": True, "status": status_code, "raw_response": raw_body}
        except urllib.error.HTTPError as exc:
            err_body = exc.read().decode("utf-8", errors="replace")
            try:
                err_json = json.loads(err_body)
                err_msg = err_json.get("error") or err_json.get("message") or err_body
            except Exception:
                err_msg = err_body
            return {
                "ok": False,
                "status": exc.code,
                "error": f"HTTP {exc.code}: {err_msg}",
            }
        except urllib.error.URLError as exc:
            return {
                "ok": False,
                "status": 0,
                "error": f"Connection failed to {url}: {exc.reason}",
            }
        except TimeoutError:
            return {
                "ok": False,
                "status": 0,
                "error": f"Request to {url} timed out after {timeout} seconds",
            }
        except Exception as exc:
            return {
                "ok": False,
                "status": 0,
                "error": f"Unexpected error communicating with {url}: {exc}",
            }

    def get_status(self, node_name: Optional[str] = None) -> Dict[str, Any]:
        """Fetch status and health info from a Herdr gateway node."""
        try:
            resolved_name, base_url, token = self.resolve_node(node_name)
        except ValueError as exc:
            return {"ok": False, "node": node_name, "error": str(exc)}

        url = f"{base_url}/status"
        res = self._http_request("GET", url, token)
        res["node"] = resolved_name
        res["url"] = base_url
        return res

    def list_nodes(self, check_health: bool = False) -> List[Dict[str, Any]]:
        """List configured nodes, optionally probing health on each."""
        config = self.load_config()
        nodes = config.get("nodes", {})
        default_node = config.get("default_node", "localhost")

        results: List[Dict[str, Any]] = []
        for name, entry in nodes.items():
            url = str(entry.get("url") or entry.get("endpoint", "")).rstrip("/")
            token = self._resolve_token(str(entry.get("token") or entry.get("auth_token", "")))
            item: Dict[str, Any] = {
                "name": name,
                "url": url,
                "is_default": (name == default_node),
            }
            if check_health and url:
                health = self._http_request("GET", f"{url}/status", token, timeout=2)
                item["online"] = health.get("ok", False)
                if health.get("ok"):
                    item["active_panes"] = health.get("active_panes", 0)
                    item["max_panes"] = health.get("max_panes")
                    item["version"] = health.get("version")
                else:
                    item["error"] = health.get("error")
            results.append(item)

        return results

    def spawn_agent(
        self,
        prompt: str,
        node_name: Optional[str] = None,
        workspace: Optional[str] = None,
        kind: str = "claude",
        name: Optional[str] = None,
        pane_direction: str = "right",
        focus: bool = False,
    ) -> Dict[str, Any]:
        """Request a pane split and agent launch on the target Herdr node."""
        try:
            resolved_name, base_url, token = self.resolve_node(node_name)
        except ValueError as exc:
            return {"ok": False, "error": str(exc)}

        payload: Dict[str, Any] = {
            "prompt": prompt,
            "kind": kind,
            "pane_direction": pane_direction,
            "focus": focus,
        }
        if workspace:
            payload["workspace"] = workspace
        if name:
            payload["name"] = name

        url = f"{base_url}/spawn"
        res = self._http_request("POST", url, token, payload=payload)
        res["node"] = resolved_name
        return res
