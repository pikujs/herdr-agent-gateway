---
name: spawn-herdr-agent
description: Securely create terminal tabs in workspaces, start coding agents (OpenCode, Pi, DSH, Claude Code, Antigravity, Codex), and inject task prompts into developer workstations running the Herdr multiplexer.
---

# spawn-herdr-agent — Herdr Remote Dispatch Skill

Use this skill when you need to delegate coding work, run builds/tests in a dedicated terminal tab, or coordinate with a subagent running inside a developer's local **Herdr** terminal multiplexer session.

---

## 🎯 Supported Agent Kinds

The gateway natively normalizes and supports:
- **`opencode`**: Open-source terminal coding assistant.
- **`pi`**: Fast persistent agent runtime.
- **`dsh`** (`dsh-cordis`): Developer shell / Cordis agent.
- **`claude`** (`claude-code`): Anthropic Claude Code CLI.
- **`antigravity`** (`agy`): Google DeepMind Antigravity coding harness.
- **`codex`**, **`cursor`**, **`gemini`**: Other supported terminal agents.

---

## 🧭 Machine Discovery (`herdr_nodes.json`)

By default, the client script queries machine profiles from:
1. `~/.config/herdr/plugins/config/herdr-remote-gateway/herdr_nodes.json` (canonical)
2. `~/.config/herdr-agent-gateway/herdr_nodes.json`
3. Direct override via `--node <id>` or `--endpoint <url>`.

If unspecified, it dispatches to the `default_node`, or walks the `fallback_order` list until an online machine is reached.

---

## 🛠 Command Reference

Execute commands using the portable POSIX wrapper:
```bash
/path/to/herdr-agent-gateway/scripts/agent-spawn-remote <command> [options]
```

### 1. Tier 1: Introspection (Safe / Auto-Approved)
```bash
# Check gateway connectivity
agent-spawn-remote health

# List active workspaces, panes, or running agents
agent-spawn-remote list workspaces
agent-spawn-remote list panes
agent-spawn-remote list agents

# Read terminal scrollback from a specific pane
agent-spawn-remote read <pane_id> --lines 100 --format text
```

### 2. Tier 2: Spawning & Prompting (Mutation)
```bash
# Create a new tab and start an agent with an initial prompt
agent-spawn-remote spawn \
  --kind opencode \
  --name refactor_worker \
  --prompt "Run pytest and refactor database queries" \
  --workspace spawned-agents

# Spawn an agent in YOLO / autonomous mode (no confirmation prompts)
agent-spawn-remote spawn \
  --kind pi \
  --name autonomous_worker \
  --workspace spawned-agents \
  --yolo \
  --prompt "Analyze project structure and run unit tests"

# Alternatively, set approval mode explicitly ('yolo', 'off', or 'prompt')
agent-spawn-remote spawn \
  --kind claude \
  --name test_claude \
  --workspace spawned-agents \
  --approval-mode yolo \
  --prompt "Fix failing linter errors"

# Submit follow-up instructions to a running agent
agent-spawn-remote prompt --agent refactor_worker "Check tests/test_api.py" --wait
```

### 3. Tier 3: Direct Control & Teardown (Destructive / Interactive)
```bash
# Send control keystrokes (e.g. cancel stuck process)
agent-spawn-remote keys <pane_id> ctrl+c

# Close a finished pane
agent-spawn-remote close <pane_id>
```

---

## 🔒 Permission System Integration

When configuring agent harnesses with permission filters:
- **Allow without prompt**:
  - `agent-spawn-remote health`
  - `agent-spawn-remote list`
  - `agent-spawn-remote read`
- **Require prompt or allow per session**:
  - `agent-spawn-remote spawn`
  - `agent-spawn-remote prompt`
- **Require explicit confirmation**:
  - `agent-spawn-remote keys`
  - `agent-spawn-remote close`
