import type { Bootstrap, Conversation, EncryptedPayload, Group, Health, Message, Post } from "../types";

const apiUrl = import.meta.env.VITE_API_URL || "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers || {}),
    },
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.error || "Erreur API");
  }
  return payload as T;
}

export function getBootstrap() {
  return request<Bootstrap>("/api/bootstrap");
}

export function getHealth() {
  return request<Health>("/health");
}

export function createPost(input: Pick<Post, "authorHandle" | "authorHash" | "body">) {
  return request<Post>("/api/posts", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createConversation(input: {
  ownerHash: string;
  peerHandle: string;
  peerHash: string;
}) {
  return request<Conversation>("/api/conversations", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createMessage(
  conversationId: string,
  input: { authorHash: string; authorHandle: string; encrypted: EncryptedPayload },
) {
  return request<Message>(`/api/conversations/${conversationId}/messages`, {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function createGroup(input: {
  ownerHash: string;
  name: string;
  topic: string;
  encryptedIntro: EncryptedPayload;
}) {
  return request<Group>("/api/groups", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
