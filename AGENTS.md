# AGENTS.md — Herdr Agent Gateway

## 🎯 Project Overview
**Herdr Agent Gateway** is a secure, authenticated integration layer for the **Herdr** terminal multiplexer. It allows external and remote AI coding agents (Claude Code, OpenCode, Cursor, Codex, etc.) to securely request workspace pane splits, register agent sessions, and inject execution prompts into a local developer workstation running Herdr.

The project provides **three primary client interfaces**:
1. **Agent Skill & POSIX CLI** (`skills/spawn_herdr_agent/` + `scripts/agent-spawn-remote`): For CLI-based agents running a portable bash/python script over LAN/VPN.
2. **MCP Server** (`packages/mcp-server/`): For tool-calling agents speaking the Model Context Protocol directly over SSE/Stdio/HTTP.
3. **Hermes Plugin** (`plugin.yaml` + `hermes_herdr/`): For [Hermes Agent](https://github.com/NousResearch/hermes-agent) running locally or remotely (NixOS / `hermes plugins install`).

Tracked in OpenProject as **`OP#358`** (Project: `pikujs-server`).

---

## 🧭 Project Exploration & Source of Truth Order
When beginning work in this repository, explore and read in this exact order:
1. **`AGENTS.md`** (This file — project mandates, conventions, and environment rules)
2. **`README.md`** (General documentation, architecture, and quickstart)
3. OpenProject Work Package **`OP#358`** (Use `python3 /home/pikujs/.gemini/config/skills/openproject/scripts/openproject_cli.py get-work-package --id 358`)

---

## 🛠 Target Architecture & Deliverables

```
herdr-agent-gateway/
├── AGENTS.md                  # Agent mandates and rules of engagement
├── README.md                  # General project documentation
├── plugin.yaml                # Hermes native plugin manifest
├── after-install.md           # Hermes post-install display guide
├── __init__.py                # Hermes plugin root entrypoint (register(ctx))
├── hermes_herdr/              # Hermes plugin implementation (tools & commands)
├── schemas/
│   └── herdr_nodes.schema.json # DEL-03: Machine profile registry schema
├── plugins/
│   └── herdr-remote-gateway/  # DEL-01: In-daemon Herdr plugin & HTTP server
│       ├── herdr-plugin.toml
│       └── ...
├── packages/
│   └── mcp-server/            # MCP server exposing gateway tools
├── skills/
│   └── spawn_herdr_agent/     # DEL-05: Skill definition (SKILL.md)
└── scripts/
    └── agent-spawn-remote     # DEL-04: Portable POSIX bash client wrapper
```

---

## ⚙️ Environment & Tooling Conventions

### Herdr Multiplexer
* **Binary Location**: `/home/pikujs/.nix-profile/bin/herdr`
* **Daemon Sockets**: `~/.config/herdr/herdr.sock`, `~/.config/herdr/herdr-client.sock`
* **Reference Plugin**: `~/.config/herdr/plugins/github/annotate-9c299759567c/`
* **Available Skill**: Activate `skill:herdr` whenever interacting with or discovering Herdr primitives.
* **CLI Discovery Rule**: Always check `herdr --help`, `herdr pane`, `herdr agent`, `herdr workspace`. Most commands output JSON. Never run bare `herdr` without subcommands (bare `herdr` launches the interactive TUI).

### Python Tooling
* **Standard**: Always use `uv` for Python environments and dependency management (`uv venv`, `uv add`, `uv run`).
* **Do NOT use**: `pip install` or `python -m venv`.

### Node / TypeScript Tooling
* Herdr plugin ecosystem supports `bun` and `node`. Check `herdr-plugin.toml` for command runner conventions.

### Issue Tracker & Commits
* **Issue Tracker**: OpenProject (`OP#358`).
* **Commit Messages**: Must reference `OP#358` (e.g., `feat(gateway): implement constant-time token auth OP#358`).
* **Status Updates**: Keep OP#358 updated when milestones or deliverables are reached.

---

## 🔒 Security & Quality Mandates
1. **Never Bind to `0.0.0.0`**: In-daemon HTTP server must refuse to start if bound to public addresses. Restrict to localhost, LAN, or VPN interfaces (Tailscale/WireGuard).
2. **Constant-Time Auth**: Use constant-time comparison for Bearer token validation to avoid timing attacks.
3. **Strict Validation**: Whitelist allowed agent kinds (`claude`, `codex`, `opencode`, `cursor`) and sanitize session names (`^[a-zA-Z0-9_-]{1,64}$`).
4. **No Raw Shell Interpolation**: Prompts must bypass shell expansion and be passed directly into Herdr PTY layers as memory strings.
5. **Clean Port Release**: Plugin must tear down HTTP listeners cleanly on daemon reload or exit signals.
