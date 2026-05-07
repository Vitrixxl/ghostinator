/* Test E2E de la story critique :
   - Alice crée son identité (Ed25519 + X25519, signature, PoW).
   - Bob fait pareil.
   - Alice ouvre une conversation avec Bob.
   - Alice envoie un DM chiffré X25519.
   - Bob fetch et déchiffre.

   Tout en HTTP réel contre une instance Express jetable lancée en JSON mode. */

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const enc = new TextEncoder();
const dec = new TextDecoder();
const PORT = 9999;
const BASE = `http://127.0.0.1:${PORT}`;

let server: ChildProcess | null = null;
let dataRoot: string | null = null;

function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

async function sha256Hex(value: string | Uint8Array) {
  const input = typeof value === "string" ? enc.encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function leadingZeroBits(bytes: Buffer | Uint8Array) {
  let zeros = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      zeros += 8;
      continue;
    }
    let mask = 0x80;
    while (mask && (byte & mask) === 0) {
      zeros += 1;
      mask >>= 1;
    }
    return zeros;
  }
  return zeros;
}

/* PoW de test : utilise node:crypto sync, ~10x plus rapide que crypto.subtle async.
   Le code de prod (Worker / navigateur) reste sur crypto.subtle.digest. */
function computePow(challenge: string, bits: number) {
  for (let n = 0; n < 2 ** 32; n += 1) {
    const nonce = n.toString(36);
    const digest = createHash("sha256")
      .update(challenge + nonce)
      .digest();
    if (leadingZeroBits(digest) >= bits) return nonce;
  }
  throw new Error("PoW non trouvé");
}

async function waitForHttp(url: string, timeoutMs = 8000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch {
      /* not ready yet */
    }
    await new Promise((res) => setTimeout(res, 100));
  }
  throw new Error("Le serveur ne répond pas sur " + url);
}

beforeAll(async () => {
  dataRoot = mkdtempSync(join(tmpdir(), "ghostinator-e2e-"));
  server = spawn("node", ["server/index.js"], {
    env: {
      ...process.env,
      PORT: String(PORT),
      // Pas de SUPABASE_* → mode JSON local.
      // Pas de TURNSTILE_SECRET_KEY → Turnstile ignoré.
    },
    cwd: process.cwd(),
    stdio: "ignore",
  });
  await waitForHttp(`${BASE}/health`);
}, 20_000);

afterAll(() => {
  if (server) server.kill("SIGTERM");
  if (dataRoot) {
    try {
      rmSync(dataRoot, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
  // Aussi nettoyer le state du serveur (data/ghostinator.json)
  try {
    rmSync(join(process.cwd(), "data", "ghostinator.json"), { force: true });
  } catch {
    /* ignore */
  }
});

type TestIdentity = {
  username: string;
  publicHash: string;
  publicKeyEd25519: string;
  publicKeyX25519: string;
  edPriv: CryptoKey;
  xPriv: CryptoKey;
};

async function forgeIdentity(username: string): Promise<TestIdentity> {
  const ed = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as CryptoKeyPair;
  const x = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
    "deriveKey",
    "deriveBits",
  ])) as CryptoKeyPair;
  const edPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", ed.publicKey));
  const xPubRaw = new Uint8Array(await crypto.subtle.exportKey("raw", x.publicKey));
  return {
    username,
    publicHash: await sha256Hex(edPubRaw),
    publicKeyEd25519: bytesToBase64(edPubRaw),
    publicKeyX25519: bytesToBase64(xPubRaw),
    edPriv: ed.privateKey,
    xPriv: x.privateKey,
  };
}

async function buildSignature(
  edPriv: CryptoKey,
  method: string,
  path: string,
  body: string,
) {
  const timestamp = Date.now().toString();
  const bodyHash = await sha256Hex(body || "");
  const message = `${method}.${path}.${timestamp}.${bodyHash}`;
  const sig = await crypto.subtle.sign("Ed25519", edPriv, enc.encode(message));
  return `${timestamp}.${bytesToBase64(new Uint8Array(sig))}`;
}

async function signedRequest(opts: {
  method: "POST" | "GET";
  path: string;
  body?: unknown;
  edPriv?: CryptoKey;
  pow?: { challenge: string; bits: number };
}) {
  const bodyText = opts.body !== undefined ? JSON.stringify(opts.body) : "";
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (opts.edPriv) {
    headers["x-signature"] = await buildSignature(opts.edPriv, opts.method, opts.path, bodyText);
  }
  if (opts.pow) {
    headers["x-pow"] = computePow(opts.pow.challenge, opts.pow.bits);
  }
  const r = await fetch(`${BASE}${opts.path}`, {
    method: opts.method,
    headers,
    body: bodyText || undefined,
  });
  const text = await r.text();
  const json = text ? JSON.parse(text) : null;
  if (!r.ok) {
    throw new Error(`HTTP ${r.status} ${json?.error || ""}`);
  }
  return json;
}

async function deriveSharedAesKey(privateKey: CryptoKey, peerPubBase64: string) {
  const peerPub = await crypto.subtle.importKey(
    "raw",
    Buffer.from(peerPubBase64, "base64"),
    { name: "X25519" },
    false,
    [],
  );
  return crypto.subtle.deriveKey(
    { name: "X25519", public: peerPub },
    privateKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

describe("Story critique : signup + DM E2EE entre Alice et Bob", () => {
  it("Alice peut envoyer un DM à Bob, et Bob seul peut le déchiffrer", async () => {
    const alice = await forgeIdentity(`alice${Date.now().toString(36)}`);
    const bob = await forgeIdentity(`bob${Date.now().toString(36)}`);

    // 1. Signup Alice avec PoW 18 bits sur le challenge "signup:<pubkeyEd25519>"
    const aliceCreated = await signedRequest({
      method: "POST",
      path: "/api/users",
      body: {
        username: alice.username,
        publicHash: alice.publicHash,
        publicKeyEd25519: alice.publicKeyEd25519,
        publicKeyX25519: alice.publicKeyX25519,
      },
      edPriv: alice.edPriv,
      pow: { challenge: `signup:${alice.publicKeyEd25519}`, bits: 18 },
    });
    expect(aliceCreated.publicHash).toBe(alice.publicHash);

    // 2. Signup Bob
    const bobCreated = await signedRequest({
      method: "POST",
      path: "/api/users",
      body: {
        username: bob.username,
        publicHash: bob.publicHash,
        publicKeyEd25519: bob.publicKeyEd25519,
        publicKeyX25519: bob.publicKeyX25519,
      },
      edPriv: bob.edPriv,
      pow: { challenge: `signup:${bob.publicKeyEd25519}`, bits: 18 },
    });
    expect(bobCreated.publicKeyX25519).toBe(bob.publicKeyX25519);

    // 3. Alice ouvre une conversation avec Bob
    const conversation = await signedRequest({
      method: "POST",
      path: "/api/conversations",
      body: {
        ownerHash: alice.publicHash,
        ownerUsername: alice.username,
        ownerPublicKeyX25519: alice.publicKeyX25519,
        peerHash: bob.publicHash,
        peerUsername: bob.username,
        peerPublicKeyX25519: bob.publicKeyX25519,
      },
      edPriv: alice.edPriv,
    });
    expect(conversation.peerPublicKeyX25519).toBe(bob.publicKeyX25519);
    expect(conversation.ownerPublicKeyX25519).toBe(alice.publicKeyX25519);

    // 4. Alice chiffre "Le bureau est ouvert." pour Bob via X25519 ECDH
    const aliceShared = await deriveSharedAesKey(alice.xPriv, bob.publicKeyX25519);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = new Uint8Array(
      await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        aliceShared,
        enc.encode("Le bureau est ouvert."),
      ),
    );
    const ivB64 = Buffer.from(iv).toString("base64");
    const cipherB64 = Buffer.from(cipher).toString("base64");

    // 5. Alice envoie le DM via l'API
    const message = await signedRequest({
      method: "POST",
      path: `/api/conversations/${conversation.id}/messages`,
      body: {
        authorHash: alice.publicHash,
        authorUsername: alice.username,
        encrypted: { iv: ivB64, cipher: cipherB64 },
      },
      edPriv: alice.edPriv,
    });
    expect(message.encrypted.cipher).toBe(cipherB64);

    // 6. Bob fetch son bootstrap et récupère le message
    const bootstrap = await fetch(
      `${BASE}/api/bootstrap?owner=${bob.publicHash}`,
    ).then((r) => r.json());
    const conv = bootstrap.conversations.find((c: { id: string }) => c.id === conversation.id);
    expect(conv).toBeDefined();
    expect(conv.messages).toHaveLength(1);

    // 7. Bob déchiffre via X25519 ECDH
    const bobShared = await deriveSharedAesKey(bob.xPriv, alice.publicKeyX25519);
    const recoveredCipher = new Uint8Array(
      Buffer.from(conv.messages[0].encrypted.cipher, "base64"),
    );
    const recoveredIv = new Uint8Array(
      Buffer.from(conv.messages[0].encrypted.iv, "base64"),
    );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: recoveredIv },
      bobShared,
      recoveredCipher,
    );

    expect(dec.decode(plain)).toBe("Le bureau est ouvert.");
  }, 30_000);

  it("Une signature invalide est rejetée par le serveur (401)", async () => {
    const eve = await forgeIdentity(`eve${Date.now().toString(36)}`);
    const otherKeypair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
    ])) as CryptoKeyPair;
    // On signe avec une mauvaise clé privée → le serveur doit rejeter.
    await expect(
      signedRequest({
        method: "POST",
        path: "/api/users",
        body: {
          username: eve.username,
          publicHash: eve.publicHash,
          publicKeyEd25519: eve.publicKeyEd25519,
          publicKeyX25519: eve.publicKeyX25519,
        },
        edPriv: otherKeypair.privateKey, // mauvaise clé
        pow: { challenge: `signup:${eve.publicKeyEd25519}`, bits: 18 },
      }),
    ).rejects.toThrow(/401|signature/i);
  }, 15_000);
});
