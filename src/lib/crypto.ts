import type { EncryptedPayload, Identity } from "../types";

const IDENTITY_KEY = "ghostinator:identity:v3";
const GROUP_KEY_PREFIX = "ghostinator:group-key:";

/* ---------- byte helpers ---------- */

function toHex(bytes: Uint8Array) {
  return [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function sha256(value: string | Uint8Array) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input as BufferSource);
  return toHex(new Uint8Array(digest));
}

export function ensureCrypto() {
  return Boolean(globalThis.crypto?.subtle);
}

/* ---------- identity (P-256 ECDH keypair) ---------- */

export async function createIdentity(username: string): Promise<Identity> {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey", "deriveBits"],
  );
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicHash = await sha256(publicKeyRaw);
  return {
    username,
    publicHash,
    publicKey: bytesToBase64(publicKeyRaw),
    privateJwk,
    createdAt: Date.now(),
  };
}

export function persistIdentity(identity: Identity) {
  localStorage.setItem(IDENTITY_KEY, JSON.stringify(identity));
}

export function loadIdentity(): Identity | null {
  const raw = localStorage.getItem(IDENTITY_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Identity;
    if (parsed.username && parsed.publicHash && parsed.privateJwk && parsed.publicKey) {
      return parsed;
    }
  } catch {
    /* fallthrough */
  }
  return null;
}

export function clearIdentity() {
  localStorage.removeItem(IDENTITY_KEY);
}

/* ---------- ECDH-derived per-peer key ---------- */

async function importPrivateKey(jwk: JsonWebKey) {
  return crypto.subtle.importKey(
    "jwk",
    jwk,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    ["deriveKey", "deriveBits"],
  );
}

async function importPeerPublicKey(rawBase64: string) {
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(rawBase64) as BufferSource,
    { name: "ECDH", namedCurve: "P-256" },
    false,
    [],
  );
}

async function derivePeerKey(identity: Identity, peerPublicKey: string) {
  const priv = await importPrivateKey(identity.privateJwk);
  const pub = await importPeerPublicKey(peerPublicKey);
  return crypto.subtle.deriveKey(
    { name: "ECDH", public: pub },
    priv,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptForPeer(
  identity: Identity,
  peerPublicKey: string,
  text: string,
): Promise<EncryptedPayload> {
  const key = await derivePeerKey(identity, peerPublicKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text) as BufferSource,
  );
  return {
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipher)),
  };
}

export async function decryptFromPeer(
  identity: Identity,
  peerPublicKey: string,
  payload: EncryptedPayload,
): Promise<string> {
  const key = await derivePeerKey(identity, peerPublicKey);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) as BufferSource },
    key,
    base64ToBytes(payload.cipher) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/* ---------- group symmetric key (locally stored) ---------- */

export async function generateGroupKey() {
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"],
  );
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return bytesToBase64(raw);
}

async function importAesKey(rawBase64: string) {
  return crypto.subtle.importKey(
    "raw",
    base64ToBytes(rawBase64) as BufferSource,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptWithKey(rawKey: string, text: string): Promise<EncryptedPayload> {
  const key = await importAesKey(rawKey);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(text) as BufferSource,
  );
  return {
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(new Uint8Array(cipher)),
  };
}

export async function decryptWithKey(rawKey: string, payload: EncryptedPayload) {
  const key = await importAesKey(rawKey);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) as BufferSource },
    key,
    base64ToBytes(payload.cipher) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

export function saveGroupKey(groupId: string, rawKey: string) {
  localStorage.setItem(`${GROUP_KEY_PREFIX}${groupId}`, rawKey);
}

export function loadGroupKey(groupId: string) {
  return localStorage.getItem(`${GROUP_KEY_PREFIX}${groupId}`);
}

/* ---------- export / display helpers ---------- */

export function identityExport(identity: Identity) {
  return JSON.stringify(
    {
      username: identity.username,
      publicHash: identity.publicHash,
      publicKey: identity.publicKey,
      privateJwk: identity.privateJwk,
      createdAt: identity.createdAt,
      v: 3,
    },
    null,
    2,
  );
}

export function shortHash(hash: string, size = 6) {
  return `${hash.slice(0, size)}…${hash.slice(-size)}`;
}
