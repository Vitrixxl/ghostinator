import type {
  Bootstrap,
  Conversation,
  EncryptedPayload,
  Group,
  Health,
  Message,
  Post,
  User,
} from "../types";
import { buildSignatureHeader, computePow } from "./crypto";

const apiUrl = import.meta.env.VITE_API_URL || "";

type RequestOptions = {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  /** Si défini : ajoute X-Signature couvrant la requête. */
  sign?: boolean;
  /** Si défini : ajoute X-Pow avec le challenge donné et le nombre de bits. */
  pow?: { challenge: string; bits: number };
  /** Si défini : ajoute X-Turnstile. */
  turnstileToken?: string;
};

async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method || "GET";
  const bodyText = opts.body !== undefined ? JSON.stringify(opts.body) : "";

  const headers: Record<string, string> = {
    "content-type": "application/json",
  };

  if (opts.sign) {
    headers["x-signature"] = await buildSignatureHeader(method, path, bodyText);
  }
  if (opts.pow) {
    const nonce = await computePow(opts.pow.challenge, opts.pow.bits);
    headers["x-pow"] = nonce;
  }
  if (opts.turnstileToken) {
    headers["x-turnstile"] = opts.turnstileToken;
  }

  const response = await fetch(`${apiUrl}${path}`, {
    method,
    headers,
    body: bodyText || undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    throw new Error(payload?.error || `Erreur API (${response.status})`);
  }
  return payload as T;
}

export function getHealth() {
  return request<Health>("/health");
}

export function getBootstrap(ownerHash?: string) {
  const query = ownerHash ? `?owner=${encodeURIComponent(ownerHash)}` : "";
  return request<Bootstrap>(`/api/bootstrap${query}`);
}

export function registerUser(input: {
  username: string;
  publicHash: string;
  publicKeyEd25519: string;
  publicKeyX25519: string;
  turnstileToken?: string;
}) {
  return request<User>("/api/users", {
    method: "POST",
    body: input,
    sign: true,
    pow: { challenge: `signup:${input.publicKeyEd25519}`, bits: 18 },
    turnstileToken: input.turnstileToken,
  });
}

export function searchUsers(query: string, exclude?: string) {
  const params = new URLSearchParams({ q: query });
  if (exclude) params.set("exclude", exclude);
  return request<User[]>(`/api/users?${params.toString()}`);
}

export function getUser(hash: string) {
  return request<User>(`/api/users/${hash}`);
}

export function createPost(input: {
  authorUsername: string;
  authorHash: string;
  body: string;
  authorPublicKeyEd25519: string;
  turnstileToken?: string;
}) {
  return request<Post>("/api/posts", {
    method: "POST",
    body: {
      authorUsername: input.authorUsername,
      authorHash: input.authorHash,
      body: input.body,
    },
    sign: true,
    pow: { challenge: `post:${input.authorPublicKeyEd25519}`, bits: 14 },
    turnstileToken: input.turnstileToken,
  });
}

export function createConversation(input: {
  ownerHash: string;
  peerHash: string;
  peerUsername: string;
  peerPublicKeyX25519: string;
}) {
  return request<Conversation>("/api/conversations", {
    method: "POST",
    body: input,
    sign: true,
  });
}

export function createMessage(
  conversationId: string,
  input: { authorHash: string; authorUsername: string; encrypted: EncryptedPayload },
) {
  return request<Message>(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: input,
    sign: true,
  });
}

export function createGroup(input: {
  ownerHash: string;
  ownerUsername: string;
  name: string;
  topic: string;
  encryptedIntro: EncryptedPayload;
}) {
  return request<Group>("/api/groups", {
    method: "POST",
    body: input,
    sign: true,
  });
}
