import crypto from "node:crypto";
import fs from "node:fs";
import type { GatewayConfig } from "./config";

export interface AuthResult {
  ok: boolean;
  identity?: string;
  error?: string;
  statusCode?: number;
}

export interface AuthorizedKeyEntry {
  type: string;
  publicKeyBase64: string;
  comment?: string;
  raw: string;
  fingerprintSha256: string;
}

let cachedKeys: AuthorizedKeyEntry[] | null = null;
let lastKeysLoad = 0;
const KEYS_CACHE_TTL_MS = 10_000;

export function loadAuthorizedKeys(paths: string[]): AuthorizedKeyEntry[] {
  const now = Date.now();
  if (cachedKeys && now - lastKeysLoad < KEYS_CACHE_TTL_MS) {
    return cachedKeys;
  }

  const entries: AuthorizedKeyEntry[] = [];
  for (const p of paths) {
    if (!fs.existsSync(p)) continue;
    try {
      const content = fs.readFileSync(p, "utf8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          const type = parts[0];
          const pubBase64 = parts[1];
          const comment = parts.slice(2).join(" ");
          try {
            const buf = Buffer.from(pubBase64, "base64");
            const hash = crypto.createHash("sha256").update(buf).digest("base64").replace(/=+$/, "");
            entries.push({
              type,
              publicKeyBase64: pubBase64,
              comment,
              raw: trimmed,
              fingerprintSha256: `SHA256:${hash}`,
            });
          } catch {}
        }
      }
    } catch (err) {
      console.error(`[auth] Failed to read authorized_keys at ${p}:`, err);
    }
  }

  cachedKeys = entries;
  lastKeysLoad = now;
  return entries;
}

/** Convert OpenSSH Ed25519 wire format to crypto.KeyObject */
function parseOpenSshEd25519Key(pubBase64: string): crypto.KeyObject {
  const wire = Buffer.from(pubBase64, "base64");
  // The raw 32-byte Ed25519 key is the last 32 bytes of the wire format
  const rawPub = wire.subarray(wire.length - 32);
  // SPKI DER prefix for ed25519 (RFC 8410)
  const spkiPrefix = Buffer.from("302a300506032b6570032100", "hex");
  const der = Buffer.concat([spkiPrefix, rawPub]);
  return crypto.createPublicKey({ key: der, format: "der", type: "spki" });
}

export function timingSafeStringCompare(a: string, b: string): boolean {
  const hashA = crypto.createHash("sha256").update(a).digest();
  const hashB = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

export async function authenticateRequest(
  req: Request,
  bodyText: string,
  config: GatewayConfig
): Promise<AuthResult> {
  const authHeader = req.headers.get("authorization") ?? "";

  // 1. Check Bearer Token
  if (authHeader.startsWith("Bearer ")) {
    const receivedToken = authHeader.slice(7).trim();
    if (!config.token) {
      return {
        ok: false,
        statusCode: 500,
        error: "Server has no auth token configured (set HERDR_GATEWAY_TOKEN or gateway.token)",
      };
    }
    if (timingSafeStringCompare(receivedToken, config.token)) {
      return { ok: true, identity: "bearer:token" };
    }
    return { ok: false, statusCode: 401, error: "Invalid Bearer token" };
  }

  // 2. Check SSH Signature Authentication
  const isSshAuth =
    authHeader.startsWith("SSH-Signature ") ||
    req.headers.has("x-herdr-signature") ||
    req.headers.has("x-herdr-key-id");

  if (isSshAuth) {
    let keyId = req.headers.get("x-herdr-key-id");
    let signatureBase64 = req.headers.get("x-herdr-signature");
    let timestampStr = req.headers.get("x-herdr-timestamp");

    if (authHeader.startsWith("SSH-Signature ")) {
      const paramStr = authHeader.slice("SSH-Signature ".length);
      for (const part of paramStr.split(",")) {
        const eqIdx = part.indexOf("=");
        if (eqIdx > 0) {
          const k = part.slice(0, eqIdx).trim();
          const v = part.slice(eqIdx + 1).trim().replace(/^["']|["']$/g, "");
          if (k === "keyId") keyId = v;
          if (k === "signature") signatureBase64 = v;
          if (k === "timestamp") timestampStr = v;
        }
      }
    }

    if (!keyId || !signatureBase64 || !timestampStr) {
      return {
        ok: false,
        statusCode: 401,
        error: "Missing required SSH signature parameters (keyId, signature, timestamp)",
      };
    }

    // Replay check (±60 seconds)
    const reqTime = Date.parse(timestampStr);
    if (isNaN(reqTime)) {
      return { ok: false, statusCode: 400, error: "Invalid timestamp format" };
    }
    const skewMs = Math.abs(Date.now() - reqTime);
    if (skewMs > 60_000) {
      return {
        ok: false,
        statusCode: 401,
        error: `Request timestamp expired or skewed beyond 60s (skew: ${skewMs}ms)`,
      };
    }

    // Body digest computation & verification
    const expectedDigest = crypto.createHash("sha256").update(bodyText).digest("base64");
    const receivedDigest = req.headers.get("x-herdr-digest");
    if (receivedDigest && receivedDigest !== `SHA-256=${expectedDigest}`) {
      return { ok: false, statusCode: 400, error: "Body digest mismatch" };
    }

    // Match in authorized_keys (plugin dir or OS ~/.ssh/authorized_keys)
    const keys = loadAuthorizedKeys(config.authorizedKeysPaths);
    const matchedKey = keys.find(
      (k) =>
        k.fingerprintSha256 === keyId ||
        k.publicKeyBase64 === keyId ||
        k.comment === keyId
    );

    if (!matchedKey) {
      return {
        ok: false,
        statusCode: 401,
        error: `Key '${keyId}' not found in authorized_keys`,
      };
    }

    const url = new URL(req.url);
    const canonicalString = `${req.method.toUpperCase()}\n${url.pathname}\n${timestampStr}\n${expectedDigest}`;

    try {
      if (matchedKey.type !== "ssh-ed25519") {
        return {
          ok: false,
          statusCode: 400,
          error: `Key type '${matchedKey.type}' not supported yet (ssh-ed25519 supported)`,
        };
      }

      const pubKeyObject = parseOpenSshEd25519Key(matchedKey.publicKeyBase64);

      const isValid = crypto.verify(
        null,
        Buffer.from(canonicalString, "utf8"),
        pubKeyObject,
        Buffer.from(signatureBase64, "base64")
      );

      if (isValid) {
        return {
          ok: true,
          identity: `ssh:${matchedKey.comment || matchedKey.fingerprintSha256}`,
        };
      }
      return { ok: false, statusCode: 401, error: "Invalid cryptographic signature" };
    } catch (err: any) {
      return {
        ok: false,
        statusCode: 401,
        error: `Signature verification error: ${err.message}`,
      };
    }
  }

  return {
    ok: false,
    statusCode: 401,
    error: "Missing Authorization header (Bearer token or SSH-Signature required)",
  };
}
