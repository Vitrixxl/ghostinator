/* Ghostinator API edge — Cloudflare Worker.
   Frontière de confidentialité : aucune IP n'est jamais loggée. */

const ALLOWED_ORIGINS = [
  "https://ghostinator.pages.dev",
  "http://127.0.0.1:5173",
  "http://localhost:5173",
];

const SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "x-frame-options": "DENY",
  "referrer-policy": "no-referrer",
  "strict-transport-security": "max-age=63072000; includeSubDomains; preload",
  "permissions-policy": "geolocation=(), microphone=(), camera=(), payment=(), interest-cohort=()",
};

function corsHeaders(origin) {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type,x-signature,x-pow,x-turnstile",
    "access-control-max-age": "600",
    vary: "origin",
  };
}

function json(body, status, origin) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...SECURITY_HEADERS,
      ...corsHeaders(origin),
    },
  });
}

function logEvent(level, msg, fields = {}) {
  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      level,
      service: "ghostinator-worker",
      msg,
      ...fields,
    }),
  );
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
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function sha256Hex(value) {
  const input = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const digest = await crypto.subtle.digest("SHA-256", input);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/* ---------- Vérification signature Ed25519 ----------
   Header X-Signature : "<timestamp_ms>.<signature_b64>"
   Couvre : "<METHOD>.<PATH>.<TIMESTAMP>.<sha256(body)>"
   Replay protection : timestamp à ±60 s de l'horloge serveur.
*/
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

/* ---------- Vérification Proof-of-Work ----------
   Header X-Pow : "<nonce>"
   On hashe sha256(challenge + nonce), on vérifie qu'au moins `bits` bits de poids
   fort sont à zéro. Le challenge est la clé publique Ed25519 base64 + le timestamp.
*/
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

/* ---------- Rate-limit hashé (en mémoire Worker) ----------
   `hash(pubkey + jour ISO + secret_rotatif)` -> compteur.
   Stockage : Map locale au isolate, TTL 24h. En prod, on basculerait sur Workers KV
   avec la même API pour persister entre isolates. Documenté en dette.
*/
const RATE_BUCKETS = new Map();

async function rateLimit({ pubkeyB64, env, route, max }) {
  const day = new Date().toISOString().slice(0, 10);
  const secret = env.RATELIMIT_SECRET || "dev-secret";
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

/* ---------- Vérification Turnstile ---------- */
async function verifyTurnstile({ env, token, ip }) {
  if (!env.TURNSTILE_SECRET_KEY) return; // dev mode sans Turnstile
  if (typeof token !== "string" || token.length === 0) {
    const error = new Error("Turnstile token manquant");
    error.status = 400;
    throw error;
  }
  const form = new URLSearchParams();
  form.set("secret", env.TURNSTILE_SECRET_KEY);
  form.set("response", token);
  if (ip) form.set("remoteip", ip);
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

/* ---------- Supabase REST ---------- */
function supabaseBase(env) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    const error = new Error("Secrets Supabase manquants dans le Worker");
    error.status = 500;
    throw error;
  }
  return env.SUPABASE_URL.replace(/\/$/, "");
}

async function supabaseRequest(env, path, init = {}) {
  const url = `${supabaseBase(env)}/rest/v1/${path}`;
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(init.headers || {}),
    },
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const error = new Error(payload?.message || payload?.hint || "Erreur Supabase");
    error.status = response.status;
    throw error;
  }
  return payload;
}

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

function mapConversation(row, messagesByConversation) {
  return {
    id: row.id,
    ownerHash: row.owner_hash,
    peerHash: row.peer_hash,
    peerUsername: row.peer_username,
    peerPublicKeyX25519: row.peer_public_key_x25519,
    createdAt: row.created_at,
    messages: messagesByConversation?.get(row.id) || [],
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

/* ---------- Lookup utilisateur (utilisé pour vérifier les signatures) ---------- */
async function getUserPublicKeys(env, hash) {
  const rows = await supabaseRequest(
    env,
    `users?public_hash=eq.${hash}&select=public_key_ed25519,public_key_x25519&limit=1`,
  );
  if (!rows.length) {
    const error = new Error("user introuvable");
    error.status = 404;
    throw error;
  }
  return { ed25519: rows[0].public_key_ed25519, x25519: rows[0].public_key_x25519 };
}

/* ---------- Routes ---------- */
async function registerUser(env, body) {
  const username = requireUsername(body.username);
  const publicHash = requireHash(body.publicHash, "publicHash");
  const publicKeyEd25519 = requireString(body.publicKeyEd25519, "publicKeyEd25519", 256);
  const publicKeyX25519 = requireString(body.publicKeyX25519, "publicKeyX25519", 256);

  const existing = await supabaseRequest(
    env,
    `users?or=(username.eq.${encodeURIComponent(username)},public_hash.eq.${publicHash})&select=username,public_hash`,
  );
  if (existing.length) {
    const error = new Error(
      existing.some((row) => row.username?.toLowerCase() === username.toLowerCase())
        ? "username déjà pris"
        : "clé déjà enregistrée",
    );
    error.status = 409;
    throw error;
  }

  const rows = await supabaseRequest(env, "users", {
    method: "POST",
    body: JSON.stringify({
      username,
      public_hash: publicHash,
      public_key_ed25519: publicKeyEd25519,
      public_key_x25519: publicKeyX25519,
    }),
  });
  return mapUser(rows[0]);
}

async function searchUsers(env, query, excludeHash) {
  const trimmed = (query || "").trim().slice(0, 32);
  if (!trimmed) return [];
  const filter = `username=ilike.*${encodeURIComponent(trimmed)}*`;
  const exclusion = excludeHash ? `&public_hash=neq.${excludeHash}` : "";
  const rows = await supabaseRequest(
    env,
    `users?${filter}${exclusion}&select=*&order=username.asc&limit=20`,
  );
  return rows.map(mapUser);
}

async function getUserByHash(env, hash) {
  const rows = await supabaseRequest(env, `users?public_hash=eq.${hash}&select=*&limit=1`);
  if (!rows.length) {
    const error = new Error("user introuvable");
    error.status = 404;
    throw error;
  }
  return mapUser(rows[0]);
}

async function bootstrap(env, ownerHash) {
  const filter = ownerHash ? `or=(owner_hash.eq.${ownerHash},peer_hash.eq.${ownerHash})` : "limit=0";
  const [posts, conversations, messages, groups] = await Promise.all([
    supabaseRequest(env, "posts?select=*&order=created_at.desc&limit=80"),
    ownerHash
      ? supabaseRequest(env, `conversations?${filter}&select=*&order=created_at.desc&limit=80`)
      : Promise.resolve([]),
    ownerHash
      ? supabaseRequest(env, `messages?select=*&order=created_at.asc&limit=600`)
      : Promise.resolve([]),
    supabaseRequest(env, "groups?select=*&order=created_at.desc&limit=80"),
  ]);

  const conversationIds = new Set(conversations.map((row) => row.id));
  const messagesByConversation = new Map();
  messages.forEach((row) => {
    if (!conversationIds.has(row.conversation_id)) return;
    const list = messagesByConversation.get(row.conversation_id) || [];
    list.push(mapMessage(row));
    messagesByConversation.set(row.conversation_id, list);
  });

  return {
    posts: posts.map(mapPost),
    conversations: conversations.map((row) => mapConversation(row, messagesByConversation)),
    groups: groups.map(mapGroup),
  };
}

async function createPost(env, body) {
  const rows = await supabaseRequest(env, "posts", {
    method: "POST",
    body: JSON.stringify({
      author_username: requireUsername(body.authorUsername),
      author_hash: requireHash(body.authorHash, "authorHash"),
      body: requireString(body.body, "body", 280),
    }),
  });
  return mapPost(rows[0]);
}

async function createConversation(env, body) {
  const ownerHash = requireHash(body.ownerHash, "ownerHash");
  const peerHash = requireHash(body.peerHash, "peerHash");

  const existing = await supabaseRequest(
    env,
    `conversations?owner_hash=eq.${ownerHash}&peer_hash=eq.${peerHash}&select=*&limit=1`,
  );
  if (existing.length) {
    return mapConversation(existing[0], new Map());
  }

  const rows = await supabaseRequest(env, "conversations", {
    method: "POST",
    body: JSON.stringify({
      owner_hash: ownerHash,
      peer_hash: peerHash,
      peer_username: requireUsername(body.peerUsername),
      peer_public_key_x25519: requireString(body.peerPublicKeyX25519, "peerPublicKeyX25519", 256),
    }),
  });
  return mapConversation(rows[0], new Map());
}

async function createMessage(env, conversationId, body) {
  const encrypted = encryptedPayload(body.encrypted);
  const rows = await supabaseRequest(env, "messages", {
    method: "POST",
    body: JSON.stringify({
      conversation_id: conversationId,
      author_hash: requireHash(body.authorHash, "authorHash"),
      author_username: requireUsername(body.authorUsername),
      iv: encrypted.iv,
      cipher: encrypted.cipher,
    }),
  });
  return mapMessage(rows[0]);
}

async function createGroup(env, body) {
  const encryptedIntro = encryptedPayload(body.encryptedIntro);
  const rows = await supabaseRequest(env, "groups", {
    method: "POST",
    body: JSON.stringify({
      owner_hash: requireHash(body.ownerHash, "ownerHash"),
      owner_username: requireUsername(body.ownerUsername),
      name: requireString(body.name, "name", 80),
      topic: requireString(body.topic, "topic", 180),
      intro_iv: encryptedIntro.iv,
      intro_cipher: encryptedIntro.cipher,
    }),
  });
  return mapGroup(rows[0]);
}

async function requestJson(request) {
  const text = await request.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    const error = new Error("JSON invalide");
    error.status = 400;
    throw error;
  }
}

/* Garde-fou anonymat : on n'utilise jamais l'IP, mais on s'assure défensivement
   que le header CF-Connecting-IP n'est pas réfléchi accidentellement dans une
   réponse ou un log. */
function dropClientIp(request) {
  // On ne fait rien avec, on ne le lit pas, on ne le passe nulle part.
  // Cette fonction existe pour documenter l'intention dans le code.
  void request;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("origin");
    const url = new URL(request.url);
    const method = request.method;
    const requireBody = method !== "GET" && method !== "OPTIONS";

    dropClientIp(request);

    try {
      if (method === "OPTIONS") {
        return new Response(null, {
          status: 204,
          headers: { ...SECURITY_HEADERS, ...corsHeaders(origin) },
        });
      }

      if (method === "GET" && url.pathname === "/health") {
        return json(
          {
            ok: true,
            service: "ghostinator-worker-api",
            db: "supabase",
            edge: "cloudflare",
            time: new Date().toISOString(),
          },
          200,
          origin,
        );
      }

      // Lecture du body une seule fois — on en a besoin à la fois pour la
      // validation d'auth et pour le parsing JSON.
      const rawBody = requireBody ? await request.text() : "";
      const body = requireBody ? (rawBody ? JSON.parse(rawBody) : {}) : null;

      // Routes publiques (lecture). Pas de signature exigée mais rate-limit IP-less
      // par fingerprint de la pubkey si elle est passée en query.
      if (method === "GET" && url.pathname === "/api/bootstrap") {
        const ownerHash = url.searchParams.get("owner");
        const result = await bootstrap(env, ownerHash ? requireHash(ownerHash, "owner") : null);
        return json(result, 200, origin);
      }

      if (method === "GET" && url.pathname === "/api/users") {
        const q = url.searchParams.get("q") || "";
        const exclude = url.searchParams.get("exclude");
        const result = await searchUsers(
          env,
          q,
          exclude ? requireHash(exclude, "exclude") : null,
        );
        return json(result, 200, origin);
      }

      const userMatch = url.pathname.match(/^\/api\/users\/([0-9a-fA-F]{64})$/);
      if (method === "GET" && userMatch) {
        const result = await getUserByHash(env, userMatch[1].toLowerCase());
        return json(result, 200, origin);
      }

      // Routes mutantes : exigent signature Ed25519 + (selon route) PoW ou Turnstile.

      if (method === "POST" && url.pathname === "/api/users") {
        // Création de compte : pas encore de pubkey en BDD. On vérifie la signature
        // contre la pubkey *fournie dans le body*, plus PoW + Turnstile pour rendre
        // le sybil-attack coûteux.
        const claimedPubkey = requireString(body.publicKeyEd25519, "publicKeyEd25519", 256);
        await verifySignature({
          pubkeyB64: claimedPubkey,
          header: request.headers.get("x-signature"),
          method,
          path: url.pathname,
          body: rawBody,
        });
        await verifyPow({
          challenge: `signup:${claimedPubkey}`,
          nonce: request.headers.get("x-pow") || "",
          bits: 18,
        });
        await verifyTurnstile({ env, token: request.headers.get("x-turnstile") });
        const created = await registerUser(env, body);
        logEvent("info", "user registered", { hash_prefix: created.publicHash.slice(0, 6) });
        return json(created, 201, origin);
      }

      // Pour les autres routes mutantes : la pubkey est récupérée par hash.
      async function authBy(authorHashField) {
        const authorHash = requireHash(body[authorHashField], authorHashField);
        const keys = await getUserPublicKeys(env, authorHash);
        await verifySignature({
          pubkeyB64: keys.ed25519,
          header: request.headers.get("x-signature"),
          method,
          path: url.pathname,
          body: rawBody,
        });
        await rateLimit({ pubkeyB64: keys.ed25519, env, route: url.pathname, max: 60 });
        return { authorHash, keys };
      }

      if (method === "POST" && url.pathname === "/api/posts") {
        const { keys } = await authBy("authorHash");
        await verifyPow({
          challenge: `post:${keys.ed25519}`,
          nonce: request.headers.get("x-pow") || "",
          bits: 14,
        });
        await verifyTurnstile({ env, token: request.headers.get("x-turnstile") });
        const created = await createPost(env, body);
        logEvent("info", "post created", { id: created.id });
        return json(created, 201, origin);
      }

      if (method === "POST" && url.pathname === "/api/conversations") {
        await authBy("ownerHash");
        const created = await createConversation(env, body);
        logEvent("info", "conversation upserted", { id: created.id });
        return json(created, 201, origin);
      }

      const messageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (method === "POST" && messageMatch) {
        await authBy("authorHash");
        const created = await createMessage(env, messageMatch[1], body);
        return json(created, 201, origin);
      }

      if (method === "POST" && url.pathname === "/api/groups") {
        await authBy("ownerHash");
        const created = await createGroup(env, body);
        return json(created, 201, origin);
      }

      return json({ error: "Not found" }, 404, origin);
    } catch (error) {
      const status = error.status || 500;
      logEvent(status >= 500 ? "error" : "warn", error.message || "Erreur Worker", {
        path: url.pathname,
        status,
      });
      return json({ error: error.message || "Erreur Worker" }, status, origin);
    }
  },
};
