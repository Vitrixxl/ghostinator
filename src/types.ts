export type EncryptedPayload = {
  iv: string;
  cipher: string;
};

export type Identity = {
  publicKey: string;
  privateJwk: JsonWebKey;
  publicHash: string;
  handle: string;
  publicName: string;
  createdAt: number;
};

export type Post = {
  id: string;
  authorHandle: string;
  authorHash: string;
  body: string;
  replies: number;
  createdAt: string;
};

export type Message = {
  id: string;
  authorHash: string;
  authorHandle: string;
  encrypted: EncryptedPayload;
  createdAt: string;
};

export type Conversation = {
  id: string;
  ownerHash: string;
  peerHandle: string;
  peerHash: string;
  createdAt: string;
  messages: Message[];
};

export type Group = {
  id: string;
  ownerHash: string;
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
