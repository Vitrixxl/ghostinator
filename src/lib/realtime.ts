/* Realtime via Supabase channels (postgres_changes).
   - Push WebSocket des INSERT sur messages, posts, conversations.
   - Le contenu chiffré (X25519+AES-GCM) reste illisible sans la clé privée.
   - Le client Supabase utilisé ici est anon, jamais le service role.

   Trade-off métadonnée documenté dans docs/tensions.md §Tension 5. */

import {
  createClient,
  type RealtimeChannel,
  type SupabaseClient,
} from "@supabase/supabase-js";
import type { Conversation, GroupMessage, Message, Post } from "../types";

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || "";
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || "";

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (!url || !anonKey) return null;
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: false },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return client;
}

export function isRealtimeEnabled(): boolean {
  return Boolean(url && anonKey);
}

/* Diagnostic exposé en DevTools : tape `__ghostDebug.realtime()` dans la console.
   Affiche l'état du Realtime et la raison si désactivé. */
declare global {
  interface Window {
    __ghostDebug?: {
      realtime: () => {
        enabled: boolean;
        url: string;
        anonKeyPresent: boolean;
        anonKeyPrefix: string;
      };
    };
  }
}
if (typeof window !== "undefined") {
  window.__ghostDebug = {
    realtime: () => ({
      enabled: isRealtimeEnabled(),
      url,
      anonKeyPresent: anonKey.length > 0,
      anonKeyPrefix: anonKey ? `${anonKey.slice(0, 12)}…` : "(missing)",
    }),
  };
}

/* ---------- mappers (snake_case Postgres -> camelCase types) ---------- */

type MessageRow = {
  id: string;
  conversation_id: string;
  author_hash: string;
  author_username: string;
  iv: string;
  cipher: string;
  created_at: string;
};

type PostRow = {
  id: string;
  author_username: string;
  author_hash: string;
  body: string;
  replies: number;
  created_at: string;
};

type GroupMessageRow = {
  id: string;
  group_id: string;
  author_hash: string;
  author_username: string;
  iv: string;
  cipher: string;
  created_at: string;
};

type ConversationRow = {
  id: string;
  owner_hash: string;
  owner_username: string;
  owner_public_key_x25519: string;
  peer_hash: string;
  peer_username: string;
  peer_public_key_x25519: string;
  created_at: string;
};

function mapMessage(row: MessageRow): Message {
  return {
    id: row.id,
    authorHash: row.author_hash,
    authorUsername: row.author_username,
    encrypted: { iv: row.iv, cipher: row.cipher },
    createdAt: row.created_at,
  };
}

function mapPost(row: PostRow): Post {
  return {
    id: row.id,
    authorUsername: row.author_username,
    authorHash: row.author_hash,
    body: row.body,
    replies: row.replies,
    createdAt: row.created_at,
  };
}

function mapConversation(row: ConversationRow): Conversation {
  return {
    id: row.id,
    ownerHash: row.owner_hash,
    ownerUsername: row.owner_username,
    ownerPublicKeyX25519: row.owner_public_key_x25519,
    peerHash: row.peer_hash,
    peerUsername: row.peer_username,
    peerPublicKeyX25519: row.peer_public_key_x25519,
    createdAt: row.created_at,
    messages: [],
  };
}

function mapGroupMessage(row: GroupMessageRow): GroupMessage {
  return {
    id: row.id,
    groupId: row.group_id,
    authorHash: row.author_hash,
    authorUsername: row.author_username,
    encrypted: { iv: row.iv, cipher: row.cipher },
    createdAt: row.created_at,
  };
}

/* ---------- abonnements ---------- */

type SubscribeOptions = {
  ownerHash: string;
  onPost: (post: Post) => void;
  onMessage: (conversationId: string, message: Message) => void;
  onConversation: (conversation: Conversation) => void;
  onGroupMessage: (groupId: string, message: GroupMessage) => void;
};

/** S'abonne aux INSERT sur messages, posts, conversations. Renvoie une fonction
 *  de désabonnement à appeler dans le cleanup React. */
export function subscribeBootstrap(opts: SubscribeOptions): () => void {
  const cli = getClient();
  if (!cli) {
    console.warn(
      "[ghost/realtime] Realtime désactivé. VITE_SUPABASE_URL ou VITE_SUPABASE_ANON_KEY absents du bundle.",
      { url, anonKeyPresent: anonKey.length > 0 },
    );
    return () => {};
  }
  console.log("[ghost/realtime] Subscribing to bootstrap channel…", { url, ownerHash: opts.ownerHash.slice(0, 8) });

  const channel: RealtimeChannel = cli
    .channel("ghostinator-bootstrap")
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "posts" },
      (payload) => {
        opts.onPost(mapPost(payload.new as PostRow));
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => {
        const row = payload.new as MessageRow;
        // On reçoit TOUS les INSERT messages (RLS public). On laisse le filtrage
        // côté consommateur via le conversationId — App.tsx ne propage que si la
        // conv est connue dans son state.
        opts.onMessage(row.conversation_id, mapMessage(row));
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "conversations" },
      (payload) => {
        const row = payload.new as ConversationRow;
        // On ne propage que si l'utilisateur courant est owner ou peer.
        if (row.owner_hash !== opts.ownerHash && row.peer_hash !== opts.ownerHash) {
          return;
        }
        opts.onConversation(mapConversation(row));
      },
    )
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "group_messages" },
      (payload) => {
        const row = payload.new as GroupMessageRow;
        opts.onGroupMessage(row.group_id, mapGroupMessage(row));
      },
    )
    .subscribe((status, err) => {
      console.log("[ghost/realtime] channel status:", status, err || "");
      if (status === "SUBSCRIBED") {
        console.log("[ghost/realtime] ✓ abonné aux INSERT messages, posts, conversations, group_messages.");
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
        console.warn(
          "[ghost/realtime] échec de l'abonnement. Vérifie côté Supabase :\n" +
            " 1. supabase/schema.sql → policies SELECT publiques sur messages, conversations, group_messages\n" +
            " 2. ALTER PUBLICATION supabase_realtime ADD TABLE ... (executé)\n" +
            " 3. Aucun firewall/proxy bloquant les WebSocket vers *.supabase.co",
        );
      }
    });

  return () => {
    cli.removeChannel(channel);
  };
}
