import { createClient } from "@supabase/supabase-js";
import cors from "cors";
import "dotenv/config";
import express from "express";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, "..");
const dataDir = join(rootDir, "data");
const dbPath = join(dataDir, "ghostinator.json");
const port = Number(process.env.PORT || 8787);
const hasSupabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
const supabase = hasSupabase
  ? createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    })
  : null;

const app = express();

app.use(cors({ origin: true }));
app.use(express.json({ limit: "256kb" }));

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function seedDb() {
  return {
    posts: [
      {
        id: id("post"),
        authorHandle: "ghost:7f3c9a",
        authorHash: "7f3c9a8b2d11f7e02019f4d42fd87a4a831b6b6cb8f71f4cc29ad06f5d3d88b3",
        body: "Prototype PWA anonyme: la clé publique devient le seul identifiant stable. Le serveur voit un post public, pas une identité civile.",
        replies: 8,
        createdAt: now(),
      },
      {
        id: id("post"),
        authorHandle: "ghost:41b8e0",
        authorHash: "41b8e0cc9120778ebc6d83a26162a6928df23e82b9afd3ae4602dd73aac15d64",
        body: "Les conversations doivent être chiffrées avant le réseau. Une base compromise ne devrait exposer que des blobs.",
        replies: 21,
        createdAt: now(),
      },
      {
        id: id("post"),
        authorHandle: "node:9d03aa",
        authorHash: "9d03aa742fd984ee4891be93bf3341e66dbbd962f5d929aee726342fdd4acb18",
        body: "Posts publics, DM privés, groupes chiffrés: trois surfaces différentes, trois contrats de confidentialité explicites.",
        replies: 13,
        createdAt: now(),
      },
    ],
    conversations: [
      {
        id: id("dm"),
        ownerHash: "demo-owner-hash",
        peerHandle: "ghost:9c21f0a4",
        peerHash: "9c21f0a48e0b8af5dbb70e731fb0b98ec998901c3340a4f24c802f0e1ef0d411",
        createdAt: now(),
        messages: [
          {
            id: id("msg"),
            authorHash: "9c21f0a48e0b8af5dbb70e731fb0b98ec998901c3340a4f24c802f0e1ef0d411",
            authorHandle: "ghost:9c21f0a4",
            encrypted: {
              iv: "7p1p5+fZZbD4PCkA",
              cipher:
                "v2.demo.ciphertext.Worker-stocke-ce-blob-Supabase-le-persiste-client-seul-dechiffre",
            },
            createdAt: now(),
          },
        ],
      },
    ],
    groups: [
      {
        id: id("grp"),
        ownerHash: "demo-owner-hash",
        name: "Cercle zero-knowledge",
        topic: "Architecture, audits et limites d'un serveur volontairement aveugle.",
        encryptedIntro: {
          iv: "90d1H2hLrPv4U1ie",
          cipher: "v2.demo.group.ciphertext.zero-knowledge-intro",
        },
        memberCount: 12,
        createdAt: now(),
      },
      {
        id: id("grp"),
        ownerHash: "demo-owner-hash",
        name: "Agora publique",
        topic: "Posts publics signés par clé, modération sans profil civil.",
        encryptedIntro: {
          iv: "FvJyA7V0Qh0MB8sN",
          cipher: "v2.demo.group.ciphertext-public-agora",
        },
        memberCount: 48,
        createdAt: now(),
      },
      {
        id: id("grp"),
        ownerHash: "demo-owner-hash",
        name: "Atelier PWA",
        topic: "Cloudflare Pages, Worker API, service worker et stockage local des clés.",
        encryptedIntro: {
          iv: "k6i9o1Y+Qbxq5a3L",
          cipher: "v2.demo.group.ciphertext-pwa-workshop",
        },
        memberCount: 7,
        createdAt: now(),
      },
    ],
  };
}

function ensureDb() {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true });
  if (!existsSync(dbPath)) writeFileSync(dbPath, JSON.stringify(seedDb(), null, 2));
}

function readDb() {
  ensureDb();
  const db = JSON.parse(readFileSync(dbPath, "utf8"));
  const seeded = seedDb();
  let changed = false;
  if (!Array.isArray(db.groups) || db.groups.length === 0) {
    db.groups = seeded.groups;
    changed = true;
  }
  if (!Array.isArray(db.conversations) || db.conversations.length === 0) {
    db.conversations = seeded.conversations;
    changed = true;
  }
  if (changed) writeDb(db);
  return db;
}

function writeDb(db) {
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

function requireString(value, name, max = 5000) {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > max) {
    const error = new Error(`${name} invalide`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function encryptedPayload(input) {
  return {
    iv: requireString(input?.iv, "iv", 200),
    cipher: requireString(input?.cipher, "cipher", 10000),
  };
}

function mapPost(row) {
  return {
    id: row.id,
    authorHandle: row.author_handle,
    authorHash: row.author_hash,
    body: row.body,
    replies: row.replies,
    createdAt: row.created_at,
  };
}

function mapMessage(row) {
  return {
    id: row.id,
    authorHash: row.author_hash,
    authorHandle: row.author_handle,
    encrypted: { iv: row.iv, cipher: row.cipher },
    createdAt: row.created_at,
  };
}

function mapConversation(row) {
  return {
    id: row.id,
    ownerHash: row.owner_hash,
    peerHandle: row.peer_handle,
    peerHash: row.peer_hash,
    createdAt: row.created_at,
    messages: (row.messages || []).map(mapMessage),
  };
}

function mapGroup(row) {
  return {
    id: row.id,
    ownerHash: row.owner_hash,
    name: row.name,
    topic: row.topic,
    encryptedIntro: { iv: row.intro_iv, cipher: row.intro_cipher },
    memberCount: row.member_count,
    createdAt: row.created_at,
  };
}

const jsonRepo = {
  async bootstrap() {
    return readDb();
  },
  async createPost(input) {
    const db = readDb();
    const post = { id: id("post"), replies: 0, createdAt: now(), ...input };
    db.posts.unshift(post);
    writeDb(db);
    return post;
  },
  async createConversation(input) {
    const db = readDb();
    const conversation = { id: id("dm"), createdAt: now(), messages: [], ...input };
    db.conversations.unshift(conversation);
    writeDb(db);
    return conversation;
  },
  async createMessage(conversationId, input) {
    const db = readDb();
    const conversation = db.conversations.find((item) => item.id === conversationId);
    if (!conversation) return null;
    const message = { id: id("msg"), createdAt: now(), ...input };
    conversation.messages.push(message);
    writeDb(db);
    return message;
  },
  async createGroup(input) {
    const db = readDb();
    const group = { id: id("grp"), memberCount: 1, createdAt: now(), ...input };
    db.groups.unshift(group);
    writeDb(db);
    return group;
  },
};

const supabaseRepo = {
  async bootstrap() {
    const [posts, conversations, groups] = await Promise.all([
      supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(80),
      supabase
        .from("conversations")
        .select("*, messages(*)")
        .order("created_at", { ascending: false })
        .limit(80),
      supabase.from("groups").select("*").order("created_at", { ascending: false }).limit(80),
    ]);

    for (const result of [posts, conversations, groups]) {
      if (result.error) throw result.error;
    }

    return {
      posts: posts.data.map(mapPost),
      conversations: conversations.data.map(mapConversation),
      groups: groups.data.map(mapGroup),
    };
  },
  async createPost(input) {
    const { data, error } = await supabase
      .from("posts")
      .insert({
        author_handle: input.authorHandle,
        author_hash: input.authorHash,
        body: input.body,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapPost(data);
  },
  async createConversation(input) {
    const { data, error } = await supabase
      .from("conversations")
      .insert({
        owner_hash: input.ownerHash,
        peer_handle: input.peerHandle,
        peer_hash: input.peerHash,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapConversation({ ...data, messages: [] });
  },
  async createMessage(conversationId, input) {
    const { data, error } = await supabase
      .from("messages")
      .insert({
        conversation_id: conversationId,
        author_hash: input.authorHash,
        author_handle: input.authorHandle,
        iv: input.encrypted.iv,
        cipher: input.encrypted.cipher,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapMessage(data);
  },
  async createGroup(input) {
    const { data, error } = await supabase
      .from("groups")
      .insert({
        owner_hash: input.ownerHash,
        name: input.name,
        topic: input.topic,
        intro_iv: input.encryptedIntro.iv,
        intro_cipher: input.encryptedIntro.cipher,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapGroup(data);
  },
};

const repo = hasSupabase ? supabaseRepo : jsonRepo;

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "ghostinator-api", db: hasSupabase ? "supabase" : "json", time: now() });
});

app.get("/api/bootstrap", async (_req, res, next) => {
  try {
    res.json(await repo.bootstrap());
  } catch (error) {
    next(error);
  }
});

app.post("/api/posts", async (req, res, next) => {
  try {
    const post = await repo.createPost({
      authorHandle: requireString(req.body.authorHandle, "authorHandle", 80),
      authorHash: requireString(req.body.authorHash, "authorHash", 128),
      body: requireString(req.body.body, "body", 280),
    });
    res.status(201).json(post);
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations", async (req, res, next) => {
  try {
    const conversation = await repo.createConversation({
      ownerHash: requireString(req.body.ownerHash, "ownerHash", 128),
      peerHandle: requireString(req.body.peerHandle, "peerHandle", 80),
      peerHash: requireString(req.body.peerHash, "peerHash", 128),
    });
    res.status(201).json(conversation);
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations/:id/messages", async (req, res, next) => {
  try {
    const message = await repo.createMessage(req.params.id, {
      authorHash: requireString(req.body.authorHash, "authorHash", 128),
      authorHandle: requireString(req.body.authorHandle, "authorHandle", 80),
      encrypted: encryptedPayload(req.body.encrypted),
    });
    if (!message) return res.status(404).json({ error: "Conversation introuvable" });
    res.status(201).json(message);
  } catch (error) {
    next(error);
  }
});

app.post("/api/groups", async (req, res, next) => {
  try {
    const group = await repo.createGroup({
      ownerHash: requireString(req.body.ownerHash, "ownerHash", 128),
      name: requireString(req.body.name, "name", 80),
      topic: requireString(req.body.topic, "topic", 180),
      encryptedIntro: encryptedPayload(req.body.encryptedIntro),
    });
    res.status(201).json(group);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  res.status(error.status || 500).json({ error: error.message || "Erreur serveur" });
});

if (process.env.NODE_ENV === "production") {
  const distDir = join(rootDir, "dist");
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res) => res.sendFile(join(distDir, "index.html")));
}

app.listen(port, "127.0.0.1", () => {
  console.log(`Ghostinator API listening on http://127.0.0.1:${port} (${hasSupabase ? "Supabase" : "JSON"} mode)`);
});
