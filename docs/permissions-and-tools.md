# Permissions Architecture & Tool Taxonomy

## 1. Context & Objective

AI agent harnesses (Claude Code, OpenCode, Antigravity, Codex, Cursor, etc.) increasingly enforce fine-grained permission models. Operators configure security rules in files such as:
- `.claude/settings.json` or `.claude/permissions.json`
- `opencode.json` (permission tiers)
- Custom agent policy engines (e.g. `allowed_tools`, `confirm_tools`, `denied_tools`)

If a gateway exposes a single coarse tool (e.g. `herdr_action` with a `type` parameter), agent harnesses **cannot** differentiate between a safe read operation and a destructive kill operation.

Therefore, **Herdr Agent Gateway** implements a **strict 3-tier taxonomy** for both its **MCP tools** and **CLI subcommands**.

---

## 2. Three-Tier Security Taxonomy

```
┌────────────────────────────────────────────────────────┐
│ Tier 1: Read & Introspect (Safe / Auto-Approve)        │
│ MCP: herdr_list_*, herdr_get_*, herdr_read_*           │
│ CLI: agent-spawn-remote list, get, read                │
└────────────────────────────────────────────────────────┘
                           │
┌────────────────────────────────────────────────────────┐
│ Tier 2: Agent Dispatch & Prompting (Medium Risk)       │
│ MCP: herdr_spawn_agent, herdr_prompt_agent             │
│ CLI: agent-spawn-remote spawn, prompt                  │
└────────────────────────────────────────────────────────┘
                           │
┌────────────────────────────────────────────────────────┐
│ Tier 3: Direct Control & Teardown (High / Destructive) │
│ MCP: herdr_send_keys, herdr_close_pane                 │
│ CLI: agent-spawn-remote keys, close                    │
└────────────────────────────────────────────────────────┘
```

---

## 3. MCP Tool Definitions & Mappings

Each MCP tool has a distinct, granular tool name prefixed with `herdr_`:

| Tier | MCP Tool Name | Description | Default Risk |
|---|---|---|---|
| **Tier 1 (Read)** | `herdr_list_workspaces` | Lists all active workspaces and their summaries | Safe / Auto-allow |
| **Tier 1 (Read)** | `herdr_list_panes` | Lists all panes, tabs, and current focus states | Safe / Auto-allow |
| **Tier 1 (Read)** | `herdr_list_agents` | Lists registered coding agents and live states | Safe / Auto-allow |
| **Tier 1 (Read)** | `herdr_get_agent_status` | Detailed lifecycle status of a specific agent | Safe / Auto-allow |
| **Tier 1 (Read)** | `herdr_read_pane_output` | Reads terminal output/scrollback (lines, ANSI) | Safe / Auto-allow |
| **Tier 2 (Mutate)** | `herdr_spawn_agent` | Splits pane, launches agent, optionally prompts | Confirm / Operator Rule |
| **Tier 2 (Mutate)** | `herdr_prompt_agent` | Submits a prompt string to an existing agent | Confirm / Operator Rule |
| **Tier 3 (Control)** | `herdr_send_keys` | Sends literal keyboard shortcuts (`ctrl+c`, etc.) | High Risk / Prompt |
| **Tier 3 (Destructive)** | `herdr_close_pane` | Closes and terminates a terminal pane | High Risk / Prompt |

---

## 4. CLI Subcommand Structure (`scripts/agent-spawn-remote`)

The POSIX bash wrapper strictly mirrors this taxonomy using distinct subcommands:

```bash
# Tier 1: Safe read operations
agent-spawn-remote list workspaces
agent-spawn-remote list panes
agent-spawn-remote list agents
agent-spawn-remote read <pane_id> [--lines 100]

# Tier 2: Creation and prompting
agent-spawn-remote spawn --kind claude --name worker_01 --prompt "Run tests"
agent-spawn-remote prompt --agent worker_01 "Continue refactor"

# Tier 3: Direct input and pane teardown
agent-spawn-remote keys --agent worker_01 ctrl+c
agent-spawn-remote close --pane <pane_id>
```

---

## 5. Agent Permission Policy Configurations

### Example 1: Claude Code (`.claude/settings.json`)
Operators can selectively permit read and spawn while requiring prompts for direct keystrokes or closing panes:

```json
{
  "permissions": {
    "allow": [
      "mcp__herdr__herdr_list_*",
      "mcp__herdr__herdr_get_*",
      "mcp__herdr__herdr_read_*",
      "mcp__herdr__herdr_spawn_agent",
      "mcp__herdr__herdr_prompt_agent"
    ],
    "prompt": [
      "mcp__herdr__herdr_send_keys",
      "mcp__herdr__herdr_close_pane"
    ]
  }
}
```

### Example 2: CLI Subcommand Whitelisting (Bash Harness)
For harnesses executing bash commands directly, commands are whitelisted by prefix:

```yaml
allowed_command_prefixes:
  - "agent-spawn-remote list"
  - "agent-spawn-remote read"
  - "agent-spawn-remote spawn"
  - "agent-spawn-remote prompt"

# Denied or requires interactive operator confirmation:
ask_before_executing:
  - "agent-spawn-remote keys"
  - "agent-spawn-remote close"
```

### Example 3: Read-Only Worker Agent Profile
For an agent acting purely as an auditor or observer:

```json
{
  "permissions": {
    "allow": [
      "mcp__herdr__herdr_list_*",
      "mcp__herdr__herdr_read_pane_output"
    ],
    "deny": [
      "mcp__herdr__herdr_spawn_agent",
      "mcp__herdr__herdr_prompt_agent",
      "mcp__herdr__herdr_send_keys",
      "mcp__herdr__herdr_close_pane"
    ]
  }
}
```
