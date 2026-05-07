export type EncryptedPayload = {
  iv: string;
  cipher: string;
};

export type User = {
  id: string;
  username: string;
  publicHash: string;
  publicKeyEd25519: string;
  publicKeyX25519: string;
  createdAt: string;
};

export type Identity = {
  username: string;
  publicHash: string;
  publicKeyEd25519: string;
  publicKeyX25519: string;
  privateJwkEd25519: JsonWebKey;
  privateJwkX25519: JsonWebKey;
  createdAt: number;
  version: number;
  /** Présent uniquement pour les blobs « clé de groupe » (pas pour les vraies identités). */
  groupRawKey?: string;
};

export type Post = {
  id: string;
  authorUsername: string;
  authorHash: string;
  body: string;
  replies: number;
  createdAt: string;
};

export type Message = {
  id: string;
  authorHash: string;
  authorUsername: string;
  encrypted: EncryptedPayload;
  createdAt: string;
};

export type Conversation = {
  id: string;
  ownerHash: string;
  peerHash: string;
  peerUsername: string;
  peerPublicKeyX25519: string;
  createdAt: string;
  messages: Message[];
};

export type Group = {
  id: string;
  ownerHash: string;
  ownerUsername: string;
  name: string;
  topic: string;
  encryptedIntro: EncryptedPayload;
  memberCount: number;
  createdAt: string;
};

export type Bootstrap = {
  posts: Post[];
  conversations: Conversation[];
  groups: Group[];
};

export type Health = {
  ok: boolean;
  service: string;
  db: "supabase" | "json";
  edge?: string;
  time?: string;
};
