# REST API Specification — Herdr Agent Gateway

## 1. Global Conventions

* **Base Path**: `/api/v1`
* **Authentication**: `Authorization: Bearer <token>` required on all endpoints except `/health`.
* **Content-Type**: `application/json` (UTF-8).
* **Payload Limit**: Maximum 64KB per request body.
* **Error Model**:
  ```json
  {
    "error": "Human-readable description",
    "code": "MACHINE_READABLE_CODE",
    "created": {
      "workspace_id": "w1",
      "tab_id": "w1:t1",
      "pane_id": "w1:p3"
    }
  }
  ```

---

## 2. Endpoints Summary

| Method | Path | Summary | Tier |
|---|---|---|---|
| `GET` | `/api/v1/health` | Service health & Herdr socket reachability | Unauthenticated |
| `GET` | `/api/v1/snapshot` | Full Herdr state snapshot (workspaces, tabs, panes, agents) | Tier 1 (Read) |
| `GET` | `/api/v1/agents/kinds` | Dynamically supported agent kinds from Herdr | Tier 1 (Read) |
| `GET` | `/api/v1/panes/{pane_id}` | Read terminal output from pane (`?lines=`, `?format=ansi\|text`) | Tier 1 (Read) |
| `POST` | `/api/v1/agents/spawn` | Split pane, start agent, and inject initial prompt | Tier 2 (Mutate) |
| `POST` | `/api/v1/agents/prompt` | Send a new prompt to an existing running agent | Tier 2 (Mutate) |
| `POST` | `/api/v1/panes/{pane_id}/keys` | Send raw control keys (`ctrl+c`, `esc`, `enter`) | Tier 3 (Control) |
| `POST` | `/api/v1/panes/{pane_id}/close`| Terminate and close a pane | Tier 3 (Destruct) |

---

## 3. Detailed Endpoint Specs

### `GET /api/v1/health`
Returns service status and whether the underlying `herdr.sock` is connected.
```json
{
  "status": "ok",
  "version": "0.1.0",
  "herdr_socket_connected": true,
  "herdr_version": "0.8.2"
}
```

---

### `POST /api/v1/agents/spawn`
Spawns a new pane in Herdr and initializes an agent session.

#### Query Parameters
* `sync`: Boolean (`true` or `false`, default: `true`).
  * If `true`: Waits for agent readiness and prompt acceptance before returning `201 Created`.
  * If `false`: Returns `202 Accepted` immediately once the pane is split, returning the assigned `pane_id`.

#### Request Payload
```json
{
  "workspace": "main",
  "direction": "right",
  "agent_kind": "claude",
  "agent_name": "worker_migration_01",
  "prompt": "Run database migrations and test suite.",
  "cwd": "/home/pikujs/Projects/3dlab",
  "focus": false
}
```

#### Field Rules
* `workspace`: String. If omitted or null, defaults to `"spawned-agents"`.
* `direction`: `"right"` (default) or `"down"`.
* `agent_kind`: Whitelisted: `["claude", "codex", "opencode", "cursor", "gemini", "pi"]`.
* `agent_name`: Regex `^[a-zA-Z0-9_-]{1,64}$`.
* `prompt`: Optional String, max 64KB. Injected directly into PTY without shell interpolation.
* `cwd`: Optional String. Defaults to current working directory or workspace root.
* `focus`: Boolean, default `false` (never steals developer's active typing focus).

#### Response (201 Created — `sync=true`)
```json
{
  "status": "success",
  "pane_id": "w1:p3",
  "workspace_id": "w1",
  "tab_id": "w1:t1",
  "agent_name": "worker_migration_01",
  "agent_kind": "claude",
  "session_state": "working",
  "created_at": "2026-09-13T17:45:00Z"
}
```

#### Response (202 Accepted — `sync=false`)
```json
{
  "status": "accepted",
  "pane_id": "w1:p3",
  "workspace_id": "w1",
  "tab_id": "w1:t1",
  "agent_name": "worker_migration_01",
  "agent_kind": "claude",
  "session_state": "starting"
}
```

---

### `POST /api/v1/agents/prompt`
Injects an execution prompt into an already running agent session.

#### Request Payload
```json
{
  "agent_name": "worker_migration_01",
  "prompt": "Analyze test failure in tests/test_api.py",
  "wait": false
}
```

#### Response (200 OK)
```json
{
  "status": "delivered",
  "agent_name": "worker_migration_01",
  "delivered_at": "2026-09-13T17:46:10Z"
}
```

---

### `GET /api/v1/panes/{pane_id}`
Reads recent output from the specified pane.

#### Query Parameters
* `lines`: Integer (default: 100, max: 2000).
* `format`: `"text"` (default) or `"ansi"`.

#### Response (200 OK)
```json
{
  "pane_id": "w1:p3",
  "lines": 42,
  "output": "... terminal content ..."
}
```

---

### `POST /api/v1/panes/{pane_id}/keys`
Sends key sequences (e.g. `ctrl+c`, `esc`, `enter`) to unstick an agent.

#### Request Payload
```json
{
  "keys": ["ctrl+c"]
}
```

#### Response (200 OK)
```json
{
  "status": "keys_sent",
  "pane_id": "w1:p3"
}
```

---

### `POST /api/v1/panes/{pane_id}/close`
Gracefully closes a pane.

#### Response (200 OK)
```json
{
  "status": "closed",
  "pane_id": "w1:p3"
}
```
