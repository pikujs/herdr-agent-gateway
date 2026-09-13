# Authentication & Security Architecture — Herdr Agent Gateway

## 1. Threat Model & Security Goals

When exposing an API that can split terminal panes and execute prompts on a developer's workstation:
- **Threat 1: Unauthorized execution** (an attacker sends arbitrary prompts or code).
- **Threat 2: Replay attacks** (an attacker intercepts an authorized request on the LAN/web and replays it).
- **Threat 3: Man-in-the-middle / Tampering** (an attacker alters prompt payloads in transit).
- **Threat 4: Credential compromise** (a shared static secret leaked from a remote agent log).

To support environments ranging from local loopback and Tailscale mesh to public web exposure, the gateway supports **Dual Authentication Engines**.

---

## 2. Authentication Engines

```
                               Incoming HTTP Request
                                         │
                         ┌───────────────┴───────────────┐
                         ▼                               ▼
                 Authorization: Bearer          Authorization: SSH-Signature
                         │                               │
                [Bearer Token Engine]          [SSH Key Verification Engine]
                         │                               │
              Constant-time secret match         1. Validate timestamp (±60s)
                                                 2. Compute SHA-256 body digest
                                                 3. Verify Ed25519/RSA signature
                                                    against authorized_keys
                         │                               │
                         └───────────────┬───────────────┘
                                         ▼
                               [Request Authorized]
```

### Engine 1: Bearer API Token (Simple & Standard)
- **Header**: `Authorization: Bearer <token>`
- **Validation**: High-entropy token (≥256-bit) verified via `crypto.timingSafeEqual` over SHA-256 hashes to prevent timing attacks.
- **Best for**: Localhost, LAN, WireGuard, and Tailscale private networks.
- **Config**:
  - Token file: `~/.config/herdr/plugins/config/herdr-remote-gateway/gateway.token`
  - Or environment variable: `HERDR_GATEWAY_TOKEN`

---

### Engine 2: SSH Key Signature Authentication (Zero-Shared-Secret & Public Web Safe)
Developers and automated agents already manage SSH keys (`~/.ssh/id_ed25519` or `~/.ssh/id_rsa`). Rather than generating and distributing new static API tokens, clients can sign HTTP requests with their private SSH key.

#### How It Works:
1. **Server Configuration (`authorized_keys`)**:
   - The gateway server reads:
     `~/.config/herdr/plugins/config/herdr-remote-gateway/authorized_keys and standard OS ~/.ssh/authorized_keys`
   - Accepts standard OpenSSH public keys (e.g. `ssh-ed25519 AAAAC3NzaC1lZDI1NTE5... agent@remote-node`).
2. **Client Request Signing**:
   - The client constructs a canonical signature string:
     ```
     (request-target): post /api/v1/agents/spawn
     date: 2026-09-13T23:15:00.000Z
     digest: SHA-256=47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU=
     ```
   - The client signs this string using their local SSH private key (`~/.ssh/id_ed25519`).
   - The client sends the headers:
     ```http
     X-Herdr-Timestamp: 2026-09-13T23:15:00.000Z
     X-Herdr-Digest: SHA-256=47DEQpj8HBSa...
     Authorization: SSH-Signature keyId="SHA256:fingerprint",signature="..."
     ```
3. **Gateway Verification**:
   - **Timestamp Check**: `|now - X-Herdr-Timestamp| <= 60 seconds` (defeats replay attacks).
   - **Digest Check**: Recomputes SHA-256 over raw request body and verifies match (defeats tampering).
   - **Signature Check**: Looks up public key by fingerprint in `authorized_keys` and verifies signature using native `crypto.verify`.
4. **Benefits for Public Web**:
   - **No static secret stored on server or transmitted over the wire**.
   - If server state is leaked, client private keys remain completely safe.
   - Nonce/timestamp window prevents replaying recorded requests.

---

## 3. Public Web Exposure Options

When exposing the gateway outside of Tailscale/LAN:

1. **Native TLS**:
   - Configure `HERDR_GATEWAY_TLS_CERT` and `HERDR_GATEWAY_TLS_KEY` in `gateway.env`.
   - Bun's native HTTP server serves HTTPS with TLS termination.
2. **Reverse Proxy / Cloudflare Tunnel / Authentik**:
   - Gateway binds to `127.0.0.1:9480`.
   - Exposed via reverse proxy (Nginx, Caddy, Cloudflare Tunnel, or FRP).
   - Trusted reverse proxies pass client IPs via `X-Forwarded-For`.
3. **Rate Limiting & Anti-DoS**:
   - In-memory sliding window rate limiter: maximum 30 requests/minute per client IP/key.
   - Strict 64KB payload ceiling enforced before body buffering.

---

## 4. Primary Supported Agents Whitelist & Mapping

The gateway normalizes incoming agent requests to Herdr's native agent kind identifiers:

| Target Agent | Client Name Alias | Herdr Canonical Kind | Executable Detected |
|---|---|---|---|
| **OpenCode** | `opencode` | `opencode` | `opencode` |
| **Pi** | `pi` | `pi` | `pi` |
| **DSH** | `dsh`, `dsh-cordis` | `pi` / custom | Interactive shell / Pi harness |
| **Claude Code** | `claude`, `claude-code` | `claude` | `claude` |
| **Antigravity** | `antigravity`, `agy` | `agy` | `agy` |
| **Codex** | `codex` | `codex` | `codex` |
| **Cursor** | `cursor` | `cursor` | `cursor` |
| **Gemini** | `gemini` | `gemini` | `gemini` |
