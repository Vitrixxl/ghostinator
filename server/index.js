/* Ghostinator API dev (fallback Express).
   Même surface d'API que worker/src/index.js. Choisit Supabase si
   SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY sont présents, sinon JSON local. */

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

const ALLOWED_ORIGINS = [
  "http://127.0.0.1:5173",
  "http://localhost:5173",
  "https://ghostinator.pages.dev",
];

const app = express();

app.use((req, res, next) => {
  res.set("x-content-type-options", "nosniff");
  res.set("x-frame-options", "DENY");
  res.set("referrer-policy", "no-referrer");
  res.set(
    "permissions-policy",
    "geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()",
  );
  next();
});

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      callback(new Error("Origin non autorisé"));
    },
    methods: ["GET", "POST", "DELETE", "OPTIONS"],
    allowedHeaders: ["content-type", "x-signature", "x-pow", "x-turnstile"],
    maxAge: 600,
  }),
);
app.use(express.json({ limit: "256kb" }));

function logEvent(level, msg, fields = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: "ghostinator-api-dev",
      msg,
      ...fields,
    }),
  );
}

function now() {
  return new Date().toISOString();
}

function id(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 18)}`;
}

function requireString(value, name, max = 5000, min = 1) {
  if (typeof value !== "string" || value.trim().length < min || value.length > max) {
    const error = new Error(`${name} invalide`);
    error.status = 400;
    throw error;
  }
  return value.trim();
}

function requireUsername(value) {
  const username = requireString(value, "username", 32, 2);
  if (!/^[a-zA-Z0-9_.\-]+$/.test(username)) {
    const error = new Error("username invalide (a-z 0-9 _ . - autorisés)");
    error.status = 400;
    throw error;
  }
  return username;
}

function requireHash(value, name = "hash") {
  const hash = requireString(value, name, 64, 64);
  if (!/^[0-9a-fA-F]{64}$/.test(hash)) {
    const error = new Error(`${name} invalide`);
    error.status = 400;
    throw error;
  }
  return hash.toLowerCase();
}

function encryptedPayload(input) {
  return {
    iv: requireString(input?.iv, "iv", 200),
    cipher: requireString(input?.cipher, "cipher", 10000),
  };
}

function base64ToBytes(value) {
  return Uint8Array.from(Buffer.from(value, "base64"));
}

async function sha256Hex(value) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function verifySignature({ pubkeyB64, header, method, path, body }) {
  if (typeof header !== "string" || !header.includes(".")) {
    const error = new Error("X-Signature manquant");
    error.status = 401;
    throw error;
  }
  const dot = header.indexOf(".");
  const timestamp = header.slice(0, dot);
  const signatureB64 = header.slice(dot + 1);
  const ts = Number(timestamp);
  const age = Math.abs(Date.now() - ts);
  if (!Number.isFinite(ts) || age > 60_000) {
    const error = new Error("Signature expirée");
    error.status = 401;
    throw error;
  }
  const bodyHash = await sha256Hex(body || "");
  const message = `${method}.${path}.${timestamp}.${bodyHash}`;
  const pubkey = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(pubkeyB64),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "Ed25519",
    pubkey,
    base64ToBytes(signatureB64),
    new TextEncoder().encode(message),
  );
  if (!ok) {
    const error = new Error("Signature invalide");
    error.status = 401;
    throw error;
  }
}

async function verifyPow({ challenge, nonce, bits }) {
  if (typeof nonce !== "string" || nonce.length === 0 || nonce.length > 64) {
    const error = new Error("X-Pow manquant ou invalide");
    error.status = 400;
    throw error;
  }
  const digest = new Uint8Array(
    await crypto.subtle.digest("SHA-256", new TextEncoder().encode(challenge + nonce)),
  );
  let zeros = 0;
  for (const byte of digest) {
    if (byte === 0) {
      zeros += 8;
      continue;
    }
    let mask = 0x80;
    while (mask && (byte & mask) === 0) {
      zeros += 1;
      mask >>= 1;
    }
    break;
  }
  if (zeros < bits) {
    const error = new Error("Proof-of-Work insuffisant");
    error.status = 400;
    throw error;
  }
}

const RATE_BUCKETS = new Map();
async function rateLimit({ pubkeyB64, route, max }) {
  const day = new Date().toISOString().slice(0, 10);
  const secret = process.env.RATELIMIT_SECRET || "dev-secret";
  const key = await sha256Hex(`${pubkeyB64}.${day}.${secret}.${route}`);
  const slot = RATE_BUCKETS.get(key) || { count: 0, expires: Date.now() + 24 * 3600 * 1000 };
  if (Date.now() > slot.expires) {
    slot.count = 0;
    slot.expires = Date.now() + 24 * 3600 * 1000;
  }
  slot.count += 1;
  RATE_BUCKETS.set(key, slot);
  if (slot.count > max) {
    const error = new Error("Trop de requêtes — réessayez plus tard");
    error.status = 429;
    throw error;
  }
}

async function verifyTurnstile({ token }) {
  if (!process.env.TURNSTILE_SECRET_KEY) return; // dev mode
  if (typeof token !== "string" || token.length === 0) {
    const error = new Error("Turnstile token manquant");
    error.status = 400;
    throw error;
  }
  const form = new URLSearchParams();
  form.set("secret", process.env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  const res = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  const data = await res.json();
  if (!data.success) {
    const error = new Error("Turnstile invalide");
    error.status = 400;
    throw error;
  }
}

function seedDb() {
  return {
    users: [],
    posts: [
      {
        id: id("post"),
        authorUsername: "andros",
        authorHash: "7f3c9a8b2d11f7e02019f4d42fd87a4a831b6b6cb8f71f4cc29ad06f5d3d88b3",
        body: "Premier post du bureau. Les clés restent dans le navigateur, le serveur ne voit que des dispatches publics.",
        replies: 8,
        createdAt: now(),
      },
      {
        id: id("post"),
        authorUsername: "leah.cipher",
        authorHash: "41b8e0cc9120778ebc6d83a26162a6928df23e82b9afd3ae4602dd73aac15d64",
        body: "Une base compromise ne devrait exposer que des blobs. Les conversations sont chiffrées avant de quitter le poste.",
        replies: 21,
        createdAt: now(),
      },
    ],
    conversations: [],
    groups: [
      {
        id: id("grp"),
        ownerHash: "0000000000000000000000000000000000000000000000000000000000000000",
        ownerUsername: "andros",
        name: "Cercle zero-knowledge",
        topic: "Architecture, audits et limites d'un serveur volontairement aveugle.",
        encryptedIntro: {
          iv: "90d1H2hLrPv4U1ie",
          cipher: "v2.demo.group.ciphertext.zero-knowledge-intro",
        },
        memberCount: 12,
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
  if (!Array.isArray(db.users)) db.users = [];
  if (!Array.isArray(db.posts)) db.posts = [];
  if (!Array.isArray(db.conversations)) db.conversations = [];
  if (!Array.isArray(db.groups)) db.groups = [];
  return db;
}

function writeDb(db) {
  writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

const jsonRepo = {
  async registerUser(input) {
    const db = readDb();
    if (db.users.find((u) => u.username.toLowerCase() === input.username.toLowerCase())) {
      const error = new Error("username déjà pris");
      error.status = 409;
      throw error;
    }
    if (db.users.find((u) => u.publicHash === input.publicHash)) {
      const error = new Error("clé déjà enregistrée");
      error.status = 409;
      throw error;
    }
    const user = {
      id: id("usr"),
      username: input.username,
      publicHash: input.publicHash,
      publicKeyEd25519: input.publicKeyEd25519,
      publicKeyX25519: input.publicKeyX25519,
      createdAt: now(),
    };
    db.users.unshift(user);
    writeDb(db);
    return user;
  },
  async searchUsers(query, excludeHash) {
    const db = readDb();
    const q = (query || "").trim().toLowerCase();
    if (!q) return [];
    return db.users
      .filter((u) => u.username.toLowerCase().includes(q) && u.publicHash !== excludeHash)
      .slice(0, 20);
  },
  async getUserByHash(hash) {
    const db = readDb();
    return db.users.find((u) => u.publicHash === hash) || null;
  },
  async bootstrap(ownerHash) {
    const db = readDb();
    return {
      posts: db.posts,
      conversations: ownerHash
        ? db.conversations.filter(
            (c) => c.ownerHash === ownerHash || c.peerHash === ownerHash,
          )
        : [],
      groups: db.groups,
    };
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
    const existing = db.conversations.find(
      (c) => c.ownerHash === input.ownerHash && c.peerHash === input.peerHash,
    );
    if (existing) return existing;
    const conversation = {
      id: id("dm"),
      createdAt: now(),
      messages: [],
      ...input,
    };
    db.conversations.unshift(conversation);
    writeDb(db);
    return conversation;
  },
  async createMessage(conversationId, input) {
    const db = readDb();
    const conversation = db.conversations.find((c) => c.id === conversationId);
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

function mapUser(row) {
  return {
    id: row.id,
    username: row.username,
    publicHash: row.public_hash,
    publicKeyEd25519: row.public_key_ed25519,
    publicKeyX25519: row.public_key_x25519,
    createdAt: row.created_at,
  };
}

function mapPost(row) {
  return {
    id: row.id,
    authorUsername: row.author_username,
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
    authorUsername: row.author_username,
    encrypted: { iv: row.iv, cipher: row.cipher },
    createdAt: row.created_at,
  };
}

function mapConversation(row) {
  return {
    id: row.id,
    ownerHash: row.owner_hash,
    peerHash: row.peer_hash,
    peerUsername: row.peer_username,
    peerPublicKeyX25519: row.peer_public_key_x25519,
    createdAt: row.created_at,
    messages: (row.messages || []).map(mapMessage),
  };
}

function mapGroup(row) {
  return {
    id: row.id,
    ownerHash: row.owner_hash,
    ownerUsername: row.owner_username,
    name: row.name,
    topic: row.topic,
    encryptedIntro: { iv: row.intro_iv, cipher: row.intro_cipher },
    memberCount: row.member_count,
    createdAt: row.created_at,
  };
}

const supabaseRepo = {
  async registerUser(input) {
    const { data: existing } = await supabase
      .from("users")
      .select("username,public_hash")
      .or(`username.eq.${input.username},public_hash.eq.${input.publicHash}`);
    if (existing && existing.length) {
      const taken = existing.some(
        (row) => row.username?.toLowerCase() === input.username.toLowerCase(),
      );
      const error = new Error(taken ? "username déjà pris" : "clé déjà enregistrée");
      error.status = 409;
      throw error;
    }
    const { data, error } = await supabase
      .from("users")
      .insert({
        username: input.username,
        public_hash: input.publicHash,
        public_key_ed25519: input.publicKeyEd25519,
        public_key_x25519: input.publicKeyX25519,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapUser(data);
  },
  async searchUsers(query, excludeHash) {
    const trimmed = (query || "").trim().slice(0, 32);
    if (!trimmed) return [];
    let req = supabase
      .from("users")
      .select("*")
      .ilike("username", `%${trimmed}%`)
      .order("username", { ascending: true })
      .limit(20);
    if (excludeHash) req = req.neq("public_hash", excludeHash);
    const { data, error } = await req;
    if (error) throw error;
    return data.map(mapUser);
  },
  async getUserByHash(hash) {
    const { data, error } = await supabase
      .from("users")
      .select("*")
      .eq("public_hash", hash)
      .maybeSingle();
    if (error) throw error;
    return data ? mapUser(data) : null;
  },
  async bootstrap(ownerHash) {
    const [posts, groups, conversations] = await Promise.all([
      supabase.from("posts").select("*").order("created_at", { ascending: false }).limit(80),
      supabase.from("groups").select("*").order("created_at", { ascending: false }).limit(80),
      ownerHash
        ? supabase
            .from("conversations")
            .select("*, messages(*)")
            .or(`owner_hash.eq.${ownerHash},peer_hash.eq.${ownerHash}`)
            .order("created_at", { ascending: false })
            .limit(80)
        : Promise.resolve({ data: [], error: null }),
    ]);

    for (const result of [posts, groups, conversations]) {
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
        author_username: input.authorUsername,
        author_hash: input.authorHash,
        body: input.body,
      })
      .select("*")
      .single();
    if (error) throw error;
    return mapPost(data);
  },
  async createConversation(input) {
    const { data: existing } = await supabase
      .from("conversations")
      .select("*")
      .eq("owner_hash", input.ownerHash)
      .eq("peer_hash", input.peerHash)
      .maybeSingle();
    if (existing) return mapConversation({ ...existing, messages: [] });
    const { data, error } = await supabase
      .from("conversations")
      .insert({
        owner_hash: input.ownerHash,
        peer_hash: input.peerHash,
        peer_username: input.peerUsername,
        peer_public_key_x25519: input.peerPublicKeyX25519,
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
        author_username: input.authorUsername,
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
        owner_username: input.ownerUsername,
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

async function getUserPublicKeysOrThrow(hash) {
  const user = await repo.getUserByHash(hash);
  if (!user) {
    const error = new Error("user introuvable");
    error.status = 404;
    throw error;
  }
  return { ed25519: user.publicKeyEd25519, x25519: user.publicKeyX25519 };
}

async function authBy({ req, authorHashField }) {
  const authorHash = requireHash(req.body[authorHashField], authorHashField);
  const keys = await getUserPublicKeysOrThrow(authorHash);
  const rawBody = JSON.stringify(req.body);
  await verifySignature({
    pubkeyB64: keys.ed25519,
    header: req.get("x-signature"),
    method: req.method,
    path: req.path,
    body: rawBody,
  });
  await rateLimit({ pubkeyB64: keys.ed25519, route: req.path, max: 60 });
  return { authorHash, keys };
}

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    service: "ghostinator-api",
    db: hasSupabase ? "supabase" : "json",
    edge: "node-dev",
    time: now(),
  });
});

app.get("/api/bootstrap", async (req, res, next) => {
  try {
    const owner = req.query.owner ? requireHash(req.query.owner, "owner") : null;
    res.json(await repo.bootstrap(owner));
  } catch (error) {
    next(error);
  }
});

app.post("/api/users", async (req, res, next) => {
  try {
    const claimedPubkey = requireString(
      req.body.publicKeyEd25519,
      "publicKeyEd25519",
      256,
    );
    const rawBody = JSON.stringify(req.body);
    await verifySignature({
      pubkeyB64: claimedPubkey,
      header: req.get("x-signature"),
      method: req.method,
      path: req.path,
      body: rawBody,
    });
    await verifyPow({
      challenge: `signup:${claimedPubkey}`,
      nonce: req.get("x-pow") || "",
      bits: 18,
    });
    await verifyTurnstile({ token: req.get("x-turnstile") });
    const user = await repo.registerUser({
      username: requireUsername(req.body.username),
      publicHash: requireHash(req.body.publicHash, "publicHash"),
      publicKeyEd25519: claimedPubkey,
      publicKeyX25519: requireString(req.body.publicKeyX25519, "publicKeyX25519", 256),
    });
    logEvent("info", "user registered", { hash_prefix: user.publicHash.slice(0, 6) });
    res.status(201).json(user);
  } catch (error) {
    next(error);
  }
});

app.get("/api/users", async (req, res, next) => {
  try {
    const exclude = req.query.exclude ? requireHash(req.query.exclude, "exclude") : null;
    res.json(await repo.searchUsers(req.query.q, exclude));
  } catch (error) {
    next(error);
  }
});

app.get("/api/users/:hash", async (req, res, next) => {
  try {
    const hash = requireHash(req.params.hash, "hash");
    const user = await repo.getUserByHash(hash);
    if (!user) return res.status(404).json({ error: "user introuvable" });
    res.json(user);
  } catch (error) {
    next(error);
  }
});

app.post("/api/posts", async (req, res, next) => {
  try {
    const { keys } = await authBy({ req, authorHashField: "authorHash" });
    await verifyPow({
      challenge: `post:${keys.ed25519}`,
      nonce: req.get("x-pow") || "",
      bits: 14,
    });
    await verifyTurnstile({ token: req.get("x-turnstile") });
    const post = await repo.createPost({
      authorUsername: requireUsername(req.body.authorUsername),
      authorHash: requireHash(req.body.authorHash, "authorHash"),
      body: requireString(req.body.body, "body", 280),
    });
    logEvent("info", "post created", { id: post.id });
    res.status(201).json(post);
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations", async (req, res, next) => {
  try {
    await authBy({ req, authorHashField: "ownerHash" });
    const conversation = await repo.createConversation({
      ownerHash: requireHash(req.body.ownerHash, "ownerHash"),
      peerHash: requireHash(req.body.peerHash, "peerHash"),
      peerUsername: requireUsername(req.body.peerUsername),
      peerPublicKeyX25519: requireString(
        req.body.peerPublicKeyX25519,
        "peerPublicKeyX25519",
        256,
      ),
    });
    res.status(201).json(conversation);
  } catch (error) {
    next(error);
  }
});

app.post("/api/conversations/:id/messages", async (req, res, next) => {
  try {
    await authBy({ req, authorHashField: "authorHash" });
    const message = await repo.createMessage(req.params.id, {
      authorHash: requireHash(req.body.authorHash, "authorHash"),
      authorUsername: requireUsername(req.body.authorUsername),
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
    await authBy({ req, authorHashField: "ownerHash" });
    const group = await repo.createGroup({
      ownerHash: requireHash(req.body.ownerHash, "ownerHash"),
      ownerUsername: requireUsername(req.body.ownerUsername),
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
  const status = error.status || 500;
  logEvent(status >= 500 ? "error" : "warn", error.message || "Erreur serveur", { status });
  res.status(status).json({ error: error.message || "Erreur serveur" });
});

if (process.env.NODE_ENV === "production") {
  const distDir = join(rootDir, "dist");
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res) => res.sendFile(join(distDir, "index.html")));
}

app.listen(port, "127.0.0.1", () => {
  logEvent("info", "API listening", {
    url: `http://127.0.0.1:${port}`,
    mode: hasSupabase ? "supabase" : "json",
  });
});
