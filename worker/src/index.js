const jsonHeaders = {
  "content-type": "application/json; charset=utf-8",
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,authorization",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
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

function mapConversation(row, messagesByConversation) {
  return {
    id: row.id,
    ownerHash: row.owner_hash,
    peerHandle: row.peer_handle,
    peerHash: row.peer_hash,
    createdAt: row.created_at,
    messages: messagesByConversation.get(row.id) || [],
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

async function bootstrap(env) {
  const [posts, conversations, messages, groups] = await Promise.all([
    supabaseRequest(env, "posts?select=*&order=created_at.desc&limit=80"),
    supabaseRequest(env, "conversations?select=*&order=created_at.desc&limit=80"),
    supabaseRequest(env, "messages?select=*&order=created_at.asc&limit=600"),
    supabaseRequest(env, "groups?select=*&order=created_at.desc&limit=80"),
  ]);

  const messagesByConversation = new Map();
  messages.forEach((row) => {
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
      author_handle: requireString(body.authorHandle, "authorHandle", 80),
      author_hash: requireString(body.authorHash, "authorHash", 128),
      body: requireString(body.body, "body", 280),
    }),
  });
  return mapPost(rows[0]);
}

async function createConversation(env, body) {
  const rows = await supabaseRequest(env, "conversations", {
    method: "POST",
    body: JSON.stringify({
      owner_hash: requireString(body.ownerHash, "ownerHash", 128),
      peer_handle: requireString(body.peerHandle, "peerHandle", 80),
      peer_hash: requireString(body.peerHash, "peerHash", 128),
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
      author_hash: requireString(body.authorHash, "authorHash", 128),
      author_handle: requireString(body.authorHandle, "authorHandle", 80),
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
      owner_hash: requireString(body.ownerHash, "ownerHash", 128),
      name: requireString(body.name, "name", 80),
      topic: requireString(body.topic, "topic", 180),
      intro_iv: encryptedIntro.iv,
      intro_cipher: encryptedIntro.cipher,
    }),
  });
  return mapGroup(rows[0]);
}

async function requestJson(request) {
  try {
    return await request.json();
  } catch {
    const error = new Error("JSON invalide");
    error.status = 400;
    throw error;
  }
}

export default {
  async fetch(request, env) {
    try {
      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: jsonHeaders });
      }

      const url = new URL(request.url);
      const method = request.method;

      if (method === "GET" && url.pathname === "/health") {
        return json({ ok: true, service: "ghostinator-worker-api", db: "supabase", edge: "cloudflare" });
      }

      if (method === "GET" && url.pathname === "/api/bootstrap") {
        return json(await bootstrap(env));
      }

      if (method === "POST" && url.pathname === "/api/posts") {
        return json(await createPost(env, await requestJson(request)), 201);
      }

      if (method === "POST" && url.pathname === "/api/conversations") {
        return json(await createConversation(env, await requestJson(request)), 201);
      }

      const messageMatch = url.pathname.match(/^\/api\/conversations\/([^/]+)\/messages$/);
      if (method === "POST" && messageMatch) {
        return json(await createMessage(env, messageMatch[1], await requestJson(request)), 201);
      }

      if (method === "POST" && url.pathname === "/api/groups") {
        return json(await createGroup(env, await requestJson(request)), 201);
      }

      return json({ error: "Not found" }, 404);
    } catch (error) {
      return json({ error: error.message || "Erreur Worker" }, error.status || 500);
    }
  },
};
