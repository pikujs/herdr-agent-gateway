import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { createServer } from "../src/server";
import { timingSafeStringCompare } from "../src/auth";
import { resolveAgentYoloArgs, DEFAULT_AGENT_YOLO_ARGS } from "../src/config";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";

const TEST_PORT = 19480;
const TEST_TOKEN = "test_secret_token_1234567890abcdef";

describe("Herdr Agent Gateway Server", () => {
  let server: any;
  const baseUrl = `http://127.0.0.1:${TEST_PORT}`;

  beforeAll(() => {
    server = createServer({
      host: "127.0.0.1",
      port: TEST_PORT,
      token: TEST_TOKEN,
    });
  });

  afterAll(() => {
    if (server) server.stop();
  });

  it("performs constant-time string comparison reliably", () => {
    expect(timingSafeStringCompare("hello", "hello")).toBe(true);
    expect(timingSafeStringCompare("hello", "world")).toBe(false);
    expect(timingSafeStringCompare(TEST_TOKEN, TEST_TOKEN)).toBe(true);
    expect(timingSafeStringCompare(TEST_TOKEN, TEST_TOKEN + "x")).toBe(false);
  });

  it("serves GET /api/v1/health unauthenticated", async () => {
    const res = await fetch(`${baseUrl}/api/v1/health`);
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.status).toBeDefined();
    expect(json.version).toBe("0.1.0");
    expect(json.herdr_socket_connected).toBeDefined();
  });

  it("rejects protected endpoints without Authorization header (401)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/snapshot`);
    expect(res.status).toBe(401);
    const json: any = await res.json();
    expect(json.code).toBe("UNAUTHORIZED");
  });

  it("rejects protected endpoints with invalid Bearer token (401)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/snapshot`, {
      headers: { Authorization: "Bearer wrong_token" },
    });
    expect(res.status).toBe(401);
    const json: any = await res.json();
    expect(json.code).toBe("UNAUTHORIZED");
  });

  it("serves GET /api/v1/agents/kinds with valid Bearer token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/agents/kinds`, {
      headers: { Authorization: `Bearer ${TEST_TOKEN}` },
    });
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.primary_agents).toContain("opencode");
    expect(json.primary_agents).toContain("pi");
    expect(json.primary_agents).toContain("claude-code");
    expect(json.primary_agents).toContain("antigravity");
  });

  it("validates agent_name regex on POST /api/v1/agents/spawn (400)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/agents/spawn`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_name: "invalid name with spaces!",
        agent_kind: "opencode",
      }),
    });
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.code).toBe("INVALID_AGENT_NAME");
  });

  it("validates agent_kind on POST /api/v1/agents/spawn (400)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/agents/spawn`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_name: "valid_name_01",
        agent_kind: "unsupported_unknown_agent_xyz",
      }),
    });
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.code).toBe("INVALID_AGENT_KIND");
  });

  it("rejects payloads exceeding 64KB ceiling (413)", async () => {
    const largeBody = "x".repeat(70_000);
    const res = await fetch(`${baseUrl}/api/v1/agents/spawn`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TEST_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        agent_name: "worker_large",
        agent_kind: "claude",
        prompt: largeBody,
      }),
    });
    expect(res.status).toBe(413);
    const json: any = await res.json();
    expect(json.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("resolves default YOLO arguments per agent kind and allows custom override", () => {
    expect(resolveAgentYoloArgs("pi")).toEqual(["--yolo"]);
    expect(resolveAgentYoloArgs("claude")).toEqual(["--dangerously-skip-permissions"]);
    expect(resolveAgentYoloArgs("claude-code")).toEqual(["--dangerously-skip-permissions"]);
    expect(resolveAgentYoloArgs("opencode")).toEqual(["--yolo"]);
    expect(resolveAgentYoloArgs("agy")).toEqual(["--yolo"]);
    expect(resolveAgentYoloArgs("antigravity")).toEqual(["--yolo"]);

    // Test custom override
    const customConfig = { pi: ["--yolo", "--custom-flag"] };
    expect(resolveAgentYoloArgs("pi", customConfig)).toEqual(["--yolo", "--custom-flag"]);
    expect(resolveAgentYoloArgs("claude", customConfig)).toEqual(["--dangerously-skip-permissions"]);
  });
});

describe("SSH Signature Authentication", () => {
  let server: any;
  let keyPair: { publicKey: string; privateKey: any };
  const SSH_PORT = 19481;
  const baseUrl = `http://127.0.0.1:${SSH_PORT}`;
  let tmpAuthKeys: string;

  beforeAll(() => {
    const gen = crypto.generateKeyPairSync("ed25519");
    const rawPub = gen.publicKey.export({ type: "spki", format: "der" }).subarray(12);

    // Encode OpenSSH wire format
    const keyType = Buffer.from("ssh-ed25519");
    const len1 = Buffer.alloc(4); len1.writeUInt32BE(keyType.length);
    const len2 = Buffer.alloc(4); len2.writeUInt32BE(rawPub.length);
    const wire = Buffer.concat([len1, keyType, len2, rawPub]);
    const sshPub = `ssh-ed25519 ${wire.toString("base64")} test-agent@domain`;

    tmpAuthKeys = path.join(os.tmpdir(), `test_auth_keys_${Date.now()}.txt`);
    fs.writeFileSync(tmpAuthKeys, `${sshPub}\n`);

    server = createServer({
      host: "127.0.0.1",
      port: SSH_PORT,
      authorizedKeysPaths: [tmpAuthKeys],
    });

    keyPair = {
      publicKey: sshPub,
      privateKey: gen.privateKey,
    };
  });

  afterAll(() => {
    if (server) server.stop();
    if (fs.existsSync(tmpAuthKeys)) fs.unlinkSync(tmpAuthKeys);
  });

  it("authenticates valid SSH-signed requests", async () => {
    const timestamp = new Date().toISOString();
    const body = "";
    const digest = crypto.createHash("sha256").update(body).digest("base64");

    const canonicalString = `GET\n/api/v1/snapshot\n${timestamp}\n${digest}`;
    const sign = crypto.sign(null, Buffer.from(canonicalString, "utf8"), keyPair.privateKey);
    const signatureBase64 = sign.toString("base64");

    const pubBase64 = keyPair.publicKey.split(" ")[1];
    const keyHash = crypto.createHash("sha256").update(Buffer.from(pubBase64, "base64")).digest("base64").replace(/=+$/, "");
    const keyId = `SHA256:${keyHash}`;

    const res = await fetch(`${baseUrl}/api/v1/snapshot`, {
      headers: {
        "x-herdr-key-id": keyId,
        "x-herdr-timestamp": timestamp,
        "x-herdr-digest": `SHA-256=${digest}`,
        "x-herdr-signature": signatureBase64,
        "Authorization": `SSH-Signature keyId="${keyId}",timestamp="${timestamp}",signature="${signatureBase64}"`,
      },
    });

    expect(res.status).not.toBe(401);
  });

  it("rejects SSH signatures with expired timestamps beyond 60s (401)", async () => {
    const expiredTimestamp = new Date(Date.now() - 120_000).toISOString();
    const body = "";
    const digest = crypto.createHash("sha256").update(body).digest("base64");

    const canonicalString = `GET\n/api/v1/snapshot\n${expiredTimestamp}\n${digest}`;
    const sign = crypto.sign(null, Buffer.from(canonicalString, "utf8"), keyPair.privateKey);
    const signatureBase64 = sign.toString("base64");

    const pubBase64 = keyPair.publicKey.split(" ")[1];
    const keyHash = crypto.createHash("sha256").update(Buffer.from(pubBase64, "base64")).digest("base64").replace(/=+$/, "");
    const keyId = `SHA256:${keyHash}`;

    const res = await fetch(`${baseUrl}/api/v1/snapshot`, {
      headers: {
        "Authorization": `SSH-Signature keyId="${keyId}",timestamp="${expiredTimestamp}",signature="${signatureBase64}"`,
      },
    });

    expect(res.status).toBe(401);
    const json: any = await res.json();
    expect(json.error).toContain("expired or skewed");
  });
});
