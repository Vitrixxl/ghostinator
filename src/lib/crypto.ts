/* Cœur cryptographique Ghostinator (v4 — 2026-05-07).
   - Identité = keypair Ed25519 (signature d'auth) + keypair X25519 (DM E2EE).
   - Stockage local : IndexedDB chiffrée via AES-GCM dérivé d'un mot de passe (PBKDF2 210k).
   - Clés groupe : symétriques AES-GCM 256 stockées dans IndexedDB chiffrées par le même
     mot de passe. Pas de partage groupe entre clients dans le MVP.
   - Toutes les primitives cryptographiques sont dans WebCrypto natif. Aucune
     dépendance externe.
*/

import type { EncryptedPayload, Identity } from "../types";
import {
  loadEncryptedIdentity,
  saveEncryptedIdentity,
  clearEncryptedIdentity,
  loadEncryptedGroupKey,
  saveEncryptedGroupKey,
} from "./keystore";

const PBKDF2_ITERATIONS = 210_000;
const PBKDF2_SALT_BYTES = 16;
const VERSION = 4;

/* ---------- helpers byte ---------- */

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

async function sha256Hex(value: string | Uint8Array) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input as BufferSource);
  return toHex(new Uint8Array(digest));
}

export function ensureCrypto() {
  return Boolean(globalThis.crypto?.subtle);
}

/* ---------- détection support Ed25519/X25519 ---------- */

let supportCache: { ed25519: boolean; x25519: boolean } | null = null;

export async function detectCurve25519Support() {
  if (supportCache) return supportCache;
  let ed25519 = false;
  let x25519 = false;
  try {
    await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
    ed25519 = true;
  } catch {
    /* unsupported */
  }
  try {
    await crypto.subtle.generateKey({ name: "X25519" }, true, ["deriveKey", "deriveBits"]);
    x25519 = true;
  } catch {
    /* unsupported */
  }
  supportCache = { ed25519, x25519 };
  return supportCache;
}

/* ---------- génération identité ---------- */

export async function createIdentity(username: string, localPassword: string): Promise<Identity> {
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
  const edPrivJwk = await crypto.subtle.exportKey("jwk", ed.privateKey);
  const xPrivJwk = await crypto.subtle.exportKey("jwk", x.privateKey);

  const publicHash = await sha256Hex(edPubRaw);

  const identity: Identity = {
    username,
    publicHash,
    publicKeyEd25519: bytesToBase64(edPubRaw),
    publicKeyX25519: bytesToBase64(xPubRaw),
    privateJwkEd25519: edPrivJwk,
    privateJwkX25519: xPrivJwk,
    createdAt: Date.now(),
    version: VERSION,
  };

  await persistIdentity(identity, localPassword);
  return identity;
}

/* ---------- IndexedDB chiffrée ---------- */

async function deriveWrappingKey(password: string, salt: Uint8Array) {
  const passKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: salt as BufferSource,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptIdentityBlob(identity: Identity, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(PBKDF2_SALT_BYTES));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveWrappingKey(password, salt);
  const plain = new TextEncoder().encode(JSON.stringify(identity));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, plain as BufferSource),
  );
  return {
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    cipher: bytesToBase64(cipher),
    version: VERSION,
  };
}

async function decryptIdentityBlob(
  blob: { salt: string; iv: string; cipher: string },
  password: string,
): Promise<Identity> {
  const salt = base64ToBytes(blob.salt);
  const iv = base64ToBytes(blob.iv);
  const cipher = base64ToBytes(blob.cipher);
  const key = await deriveWrappingKey(password, salt);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    cipher as BufferSource,
  );
  return JSON.parse(new TextDecoder().decode(plain)) as Identity;
}

export async function persistIdentity(identity: Identity, password: string) {
  const blob = await encryptIdentityBlob(identity, password);
  await saveEncryptedIdentity(blob);
  sessionPassword = password;
  cacheSessionPassword(password);
}

export async function unlockIdentity(password: string): Promise<Identity | null> {
  const blob = await loadEncryptedIdentity();
  if (!blob) return null;
  try {
    const identity = await decryptIdentityBlob(blob, password);
    sessionPassword = password;
    cacheSessionPassword(password);
    return identity;
  } catch {
    return null; // mauvais mot de passe ou blob corrompu
  }
}

/* ---------- session courte (auto-unlock après reload) ----------
   On garde le mot de passe local en sessionStorage pendant un délai (1h
   par défaut, sliding window). sessionStorage = même origine, même onglet.
   Trade-off : un attaquant XSS peut le lire — mais s'il a XSS, il peut déjà
   exfiltrer la clé en mémoire JS et tout le state. Donc même surface. */

const SESSION_KEY = "ghostinator:session:v1";
const SESSION_TTL_MS = 60 * 60 * 1000; // 1h

type SessionBlob = { password: string; expires: number };

function cacheSessionPassword(password: string, ttlMs: number = SESSION_TTL_MS) {
  try {
    const blob: SessionBlob = { password, expires: Date.now() + ttlMs };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(blob));
  } catch {
    /* sessionStorage indisponible (ex: navigation privée Safari) */
  }
}

function readCachedPassword(): string | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const blob = JSON.parse(raw) as SessionBlob;
    if (!blob.password || !blob.expires || Date.now() > blob.expires) {
      sessionStorage.removeItem(SESSION_KEY);
      return null;
    }
    // Sliding window : on prolonge à chaque accès.
    cacheSessionPassword(blob.password);
    return blob.password;
  } catch {
    return null;
  }
}

function clearCachedPassword() {
  try {
    sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** Tente de déverrouiller automatiquement avec le mot de passe en sessionStorage.
 *  Retourne null si pas de session ou si le mot de passe est invalide. */
export async function tryAutoUnlock(): Promise<Identity | null> {
  const password = readCachedPassword();
  if (!password) return null;
  return unlockIdentity(password);
}

export function clearSession() {
  clearCachedPassword();
}

export async function hasStoredIdentity(): Promise<boolean> {
  const blob = await loadEncryptedIdentity();
  return Boolean(blob);
}

export async function forgetIdentity() {
  await clearEncryptedIdentity();
  clearCachedPassword();
  deactivateIdentity();
}

/* ---------- clés en mémoire (cache pour la session) ----------
   Le mot de passe local n'est *jamais* transmis hors de l'appareil. Il est
   gardé en mémoire JS pendant la session pour permettre le scellement /
   descellement des clés de groupe sans redemander à chaque opération. */

let edPrivateCryptoKey: CryptoKey | null = null;
let xPrivateCryptoKey: CryptoKey | null = null;
let activeIdentity: Identity | null = null;
let sessionPassword: string | null = null;

export async function activateIdentity(identity: Identity, password?: string) {
  edPrivateCryptoKey = await crypto.subtle.importKey(
    "jwk",
    identity.privateJwkEd25519,
    { name: "Ed25519" },
    false,
    ["sign"],
  );
  xPrivateCryptoKey = await crypto.subtle.importKey(
    "jwk",
    identity.privateJwkX25519,
    { name: "X25519" },
    false,
    ["deriveKey", "deriveBits"],
  );
  activeIdentity = identity;
  if (password) sessionPassword = password;
}

export function deactivateIdentity() {
  edPrivateCryptoKey = null;
  xPrivateCryptoKey = null;
  activeIdentity = null;
  sessionPassword = null;
}

export function getActiveIdentity() {
  return activeIdentity;
}

/* ---------- signature Ed25519 ---------- */

export async function signMessage(message: string): Promise<string> {
  if (!edPrivateCryptoKey) throw new Error("Identité non activée");
  const sig = await crypto.subtle.sign(
    "Ed25519",
    edPrivateCryptoKey,
    new TextEncoder().encode(message) as BufferSource,
  );
  return bytesToBase64(new Uint8Array(sig));
}

export async function buildSignatureHeader(method: string, path: string, body: string) {
  const timestamp = Date.now().toString();
  const bodyHash = await sha256Hex(body || "");
  const message = `${method}.${path}.${timestamp}.${bodyHash}`;
  const sigB64 = await signMessage(message);
  return `${timestamp}.${sigB64}`;
}

/* ---------- DM E2EE via X25519 ---------- */

async function deriveSharedKey(peerPublicKeyX25519B64: string) {
  if (!xPrivateCryptoKey) throw new Error("Identité non activée");
  const peerKey = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(peerPublicKeyX25519B64) as BufferSource,
    { name: "X25519" },
    false,
    [],
  );
  return crypto.subtle.deriveKey(
    { name: "X25519", public: peerKey },
    xPrivateCryptoKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function encryptForPeer(
  peerPublicKeyX25519B64: string,
  text: string,
): Promise<EncryptedPayload> {
  const key = await deriveSharedKey(peerPublicKeyX25519B64);
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
  peerPublicKeyX25519B64: string,
  payload: EncryptedPayload,
): Promise<string> {
  const key = await deriveSharedKey(peerPublicKeyX25519B64);
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(payload.iv) as BufferSource },
    key,
    base64ToBytes(payload.cipher) as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/* ---------- clés symétriques de groupe ---------- */

export async function generateGroupKey(): Promise<string> {
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

export async function saveGroupKey(groupId: string, rawKey: string) {
  if (!sessionPassword) throw new Error("Identité non déverrouillée");
  const blob = await encryptIdentityBlob(
    {
      username: "__group__",
      publicHash: groupId,
      publicKeyEd25519: "",
      publicKeyX25519: "",
      privateJwkEd25519: {} as JsonWebKey,
      privateJwkX25519: {} as JsonWebKey,
      createdAt: Date.now(),
      version: VERSION,
      groupRawKey: rawKey,
    },
    sessionPassword,
  );
  await saveEncryptedGroupKey(groupId, blob);
}

export async function loadGroupKey(groupId: string): Promise<string | null> {
  if (!sessionPassword) return null;
  const blob = await loadEncryptedGroupKey(groupId);
  if (!blob) return null;
  try {
    const identity = await decryptIdentityBlob(blob, sessionPassword);
    return identity.groupRawKey || null;
  } catch {
    return null;
  }
}

/* ---------- Proof-of-Work Hashcash ---------- */

async function countLeadingZeroBits(bytes: Uint8Array) {
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

export async function computePow(challenge: string, bits: number): Promise<string> {
  // Recherche par incrément. ~200 ms attendus pour 18 bits sur smartphone moyen.
  for (let n = 0n; n < 1n << 32n; n += 1n) {
    const nonce = n.toString(36);
    const digest = new Uint8Array(
      await crypto.subtle.digest(
        "SHA-256",
        new TextEncoder().encode(challenge + nonce) as BufferSource,
      ),
    );
    const zeros = await countLeadingZeroBits(digest);
    if (zeros >= bits) return nonce;
  }
  throw new Error("PoW non trouvé"); // ne devrait jamais arriver pour bits ≤ 32
}

/* ---------- export / display helpers ---------- */

export function shortHash(hash: string, size = 6) {
  return `${hash.slice(0, size)}…${hash.slice(-size)}`;
}

export function identityExport(identity: Identity) {
  // Export texte JSON brut. À chiffrer côté utilisateur s'il veut le stocker hors
  // de la machine. Pas de mnémonique BIP-39 dans le MVP — dette assumée.
  return JSON.stringify(
    {
      username: identity.username,
      publicHash: identity.publicHash,
      publicKeyEd25519: identity.publicKeyEd25519,
      publicKeyX25519: identity.publicKeyX25519,
      privateJwkEd25519: identity.privateJwkEd25519,
      privateJwkX25519: identity.privateJwkX25519,
      createdAt: identity.createdAt,
      v: VERSION,
    },
    null,
    2,
  );
}

export async function identityFromImport(payload: string): Promise<Identity> {
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(payload);
  } catch {
    throw new Error("Export invalide : JSON malformé");
  }
  if (data.v !== VERSION) {
    throw new Error(`Version d'identité incompatible (attendu ${VERSION}, reçu ${data.v})`);
  }
  if (
    typeof data.username !== "string" ||
    typeof data.publicHash !== "string" ||
    typeof data.publicKeyEd25519 !== "string" ||
    typeof data.publicKeyX25519 !== "string" ||
    typeof data.privateJwkEd25519 !== "object" ||
    typeof data.privateJwkX25519 !== "object" ||
    typeof data.createdAt !== "number"
  ) {
    throw new Error("Export invalide : champs manquants");
  }
  return {
    username: data.username,
    publicHash: data.publicHash,
    publicKeyEd25519: data.publicKeyEd25519,
    publicKeyX25519: data.publicKeyX25519,
    privateJwkEd25519: data.privateJwkEd25519 as JsonWebKey,
    privateJwkX25519: data.privateJwkX25519 as JsonWebKey,
    createdAt: data.createdAt,
    version: VERSION,
  };
}

/** Restaure une identité depuis un export hors-ligne et la chiffre dans IndexedDB
 *  avec un nouveau mot de passe local (propre à ce navigateur). */
export async function restoreFromExport(
  exportJson: string,
  newLocalPassword: string,
): Promise<Identity> {
  const identity = await identityFromImport(exportJson);
  await persistIdentity(identity, newLocalPassword);
  await activateIdentity(identity, newLocalPassword);
  return identity;
}
