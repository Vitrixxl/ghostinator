import type { EncryptedPayload, Identity } from "../types";

const identityKey = "ghostinator:identity:v2";
const aesKeyPrefix = "ghostinator:aes:";

function toHex(bytes: Uint8Array) {
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function base64ToBytes(value: string) {
  return Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
}

async function sha256(value: string | Uint8Array) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input as BufferSource);
  return toHex(new Uint8Array(digest));
}

export async function generateIdentity() {
  const keyPair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveKey"],
  );
  const publicKeyRaw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
  const privateJwk = await crypto.subtle.exportKey("jwk", keyPair.privateKey);
  const publicHash = await sha256(publicKeyRaw);
  const identity: Identity = {
    publicKey: bytesToBase64(publicKeyRaw),
    privateJwk,
    publicHash,
    handle: `ghost:${publicHash.slice(0, 8)}`,
    publicName: `Anonyme ${publicHash.slice(0, 4)}`,
    createdAt: Date.now(),
  };
  localStorage.setItem(identityKey, JSON.stringify(identity));
  return identity;
}

export async function loadIdentity() {
  const stored = localStorage.getItem(identityKey);
  if (stored) {
    const parsed = JSON.parse(stored) as Identity;
    if (parsed.publicHash && parsed.privateJwk) {
      const migrated = {
        ...parsed,
        publicName: parsed.publicName || `Anonyme ${parsed.publicHash.slice(0, 4)}`,
      };
      localStorage.setItem(identityKey, JSON.stringify(migrated));
      return migrated;
    }
  }
  return generateIdentity();
}

export function savePublicName(identity: Identity, publicName: string) {
  const nextIdentity = { ...identity, publicName };
  localStorage.setItem(identityKey, JSON.stringify(nextIdentity));
  return nextIdentity;
}

export async function generateAesKey() {
  const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
    "encrypt",
    "decrypt",
  ]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key));
  return bytesToBase64(raw);
}

async function importAesKey(rawKey: string) {
  return crypto.subtle.importKey("raw", base64ToBytes(rawKey), { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptText(rawKey: string, text: string): Promise<EncryptedPayload> {
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

export async function decryptText(rawKey: string, payload: EncryptedPayload) {
  const key = await importAesKey(rawKey);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) },
    key,
    base64ToBytes(payload.cipher),
  );
  return new TextDecoder().decode(plain);
}

export function saveChannelKey(kind: "dm" | "group", id: string, rawKey: string) {
  localStorage.setItem(`${aesKeyPrefix}${kind}:${id}`, rawKey);
}

export function loadChannelKey(kind: "dm" | "group", id: string) {
  return localStorage.getItem(`${aesKeyPrefix}${kind}:${id}`);
}

export function ensureCrypto() {
  return Boolean(window.crypto?.subtle);
}
