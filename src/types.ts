export type EncryptedPayload = {
  iv: string;
  cipher: string;
};

export type User = {
  id: string;
  username: string;
  publicHash: string;
  publicKey: string; // base64 raw P-256 public key
  createdAt: string;
};

export type Identity = {
  username: string;
  publicHash: string;
  publicKey: string; // base64 raw
  privateJwk: JsonWebKey;
  createdAt: number;
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
  peerPublicKey: string;
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
