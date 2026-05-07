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

const apiUrl = import.meta.env.VITE_API_URL || "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
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

export function registerUser(input: { username: string; publicHash: string; publicKey: string }) {
  return request<User>("/api/users", { method: "POST", body: JSON.stringify(input) });
}

export function searchUsers(query: string, exclude?: string) {
  const params = new URLSearchParams({ q: query });
  if (exclude) params.set("exclude", exclude);
  return request<User[]>(`/api/users?${params.toString()}`);
}

export function getUser(hash: string) {
  return request<User>(`/api/users/${hash}`);
}

export function createPost(input: { authorUsername: string; authorHash: string; body: string }) {
  return request<Post>("/api/posts", { method: "POST", body: JSON.stringify(input) });
}

export function createConversation(input: {
  ownerHash: string;
  peerHash: string;
  peerUsername: string;
  peerPublicKey: string;
}) {
  return request<Conversation>("/api/conversations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createMessage(
  conversationId: string,
  input: { authorHash: string; authorUsername: string; encrypted: EncryptedPayload },
) {
  return request<Message>(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createGroup(input: {
  ownerHash: string;
  ownerUsername: string;
  name: string;
  topic: string;
  encryptedIntro: EncryptedPayload;
}) {
  return request<Group>("/api/groups", { method: "POST", body: JSON.stringify(input) });
}
