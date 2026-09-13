# herdr-agent-gateway

Secure in-daemon remote dispatch plugin, agent skill, and MCP server for the **Herdr** terminal multiplexer.

---

## 🚀 Overview

`herdr-agent-gateway` bridges remote coding agents (or background pipelines) to your local developer workstation running Herdr. It enables external agents to:
1. Safely split workspace panes in Herdr without taking away keyboard focus.
2. Initialize and register agent sessions (Claude Code, Cursor, OpenCode, Codex).
3. Inject task prompts and initial context directly into terminal PTY sessions without requiring raw SSH or unrestricted shell access.

### Client Interfaces
* **Agent Skill & CLI**: Portable POSIX script (`scripts/agent-spawn-remote`) and `SKILL.md` definition for command-line agent harnesses.
* **Model Context Protocol (MCP) Server**: A structured MCP server (`packages/mcp-server/`) exposing tools like `herdr_spawn_agent` and `herdr_send_prompt`.

---

## 📖 Key Documentation

* [**AGENTS.md**](AGENTS.md): Agent rules of engagement, code conventions, security constraints, and environment paths.
* [**HANDOFF.md**](HANDOFF.md): Comprehensive implementation plan, WBS phases 1–4, API specifications, and immediate next tasks.
* **OpenProject Task**: Tracked under [**OP#358**](https://openproject.pikujs.com) in project `pikujs-server`.

---

## 🛠 Project Structure

```
herdr-agent-gateway/
├── flake.nix                  # Flake packaging (packages, apps, devShells, HM module)
├── nix/                       # Package derivations and Home Manager module
│   ├── packages.nix
│   └── home-manager-module.nix
├── templates/                 # External service and env templates
├── plugins/
│   └── herdr-remote-gateway/  # In-daemon Herdr plugin (HTTP server & Herdr bindings)
├── packages/
│   └── mcp-server/            # MCP server implementation
├── skills/
│   └── spawn_herdr_agent/     # Client agent skill definition (SKILL.md)
├── scripts/
│   └── agent-spawn-remote     # Client dispatch bash script
└── schemas/
    └── herdr_nodes.schema.json # Remote machine profiles schema
```

---

## ❄️ Nix & Home Manager Integration

### 1. Flake Run & Outputs
```bash
# Run the client CLI directly
nix run git+https://gitlab.pikujs.com/pikujs/herdr-agent-gateway.git#client -- health

# Run the gateway server
nix run git+https://gitlab.pikujs.com/pikujs/herdr-agent-gateway.git#server

# Run the MCP server
nix run git+https://gitlab.pikujs.com/pikujs/herdr-agent-gateway.git#mcp-server
```

### 2. Home Manager Configuration
Import `inputs.herdr-agent-gateway.homeManagerModules.default` into your Home Manager configuration:

```nix
{ inputs, ... }:

{
  imports = [
    inputs.herdr-agent-gateway.homeManagerModules.default
  ];

  services.herdr-agent-gateway = {
    enable = true;          # Sets up and enables systemd user service
    client.enable = true;   # Installs agent-spawn-remote in PATH
    mcpServer.enable = true;# Installs herdr-mcp-server in PATH
    host = "127.0.0.1";
    port = 9480;
    defaultWorkspace = "spawned-agents";

    # Declarative YOLO args per agent
    yoloArgs = {
      pi = [ "--yolo" ];
      claude = [ "--dangerously-skip-permissions" ];
      opencode = [ "--yolo" ];
    };
  };
}
```

---

## 🔒 Security

* **Configurable Interface Binding**: Default bind is `127.0.0.1`. Can bind to LAN/VPN IP or `0.0.0.0` when explicitly set in `HERDR_GATEWAY_HOST`/`HERDR_GATEWAY_BIND`.
* **Constant-Time Authentication**: Uses constant-time token comparison for all Bearer authentication checks.
* **Input Hardening**: Enforces strict agent kind whitelisting, alphanumeric session naming, and a 64KB prompt size ceiling.
* **No Shell Interpolation**: Prompts bypass shell expansion and pass directly into Herdr PTY layers as memory strings.
