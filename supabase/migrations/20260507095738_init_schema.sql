-- Ghostinator — initial schema
-- Posture: all reads and writes go through the Cloudflare Worker using the
-- service_role key. The anon and authenticated roles are NOT granted access,
-- so even if the anon key leaks, no one can bypass the Worker.
--
-- RLS is enabled on every table as defense in depth — service_role bypasses
-- RLS, so the policies below intentionally grant no one (deny-by-default).
-- If the public feed is ever exposed directly to clients, add explicit
-- SELECT policies + GRANT to anon/authenticated at that time.

create extension if not exists citext;

-- ---------- users ----------
create table public.users (
  id uuid primary key default gen_random_uuid(),
  username citext unique not null check (
    char_length(username) between 2 and 32
    and username ~ '^[a-zA-Z0-9_.\-]+$'
  ),
  public_hash text unique not null check (char_length(public_hash) = 64),
  public_key text not null check (char_length(public_key) <= 256),
  created_at timestamptz not null default now()
);

create index users_username_lower_idx on public.users (lower(username::text));
create index users_public_hash_idx on public.users (public_hash);

-- ---------- posts (public, unencrypted) ----------
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  author_username citext not null,
  author_hash text not null check (char_length(author_hash) = 64),
  body text not null check (char_length(body) between 1 and 280),
  replies integer not null default 0 check (replies >= 0),
  created_at timestamptz not null default now()
);

create index posts_created_at_idx on public.posts (created_at desc);
create index posts_author_hash_idx on public.posts (author_hash);

-- ---------- conversations (DM metadata) ----------
create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null check (char_length(owner_hash) = 64),
  peer_hash text not null check (char_length(peer_hash) = 64),
  peer_username citext not null,
  peer_public_key text not null check (char_length(peer_public_key) <= 256),
  created_at timestamptz not null default now(),
  unique (owner_hash, peer_hash),
  check (owner_hash <> peer_hash)
);

create index conversations_owner_hash_idx on public.conversations (owner_hash);
create index conversations_peer_hash_idx on public.conversations (peer_hash);
create index conversations_created_at_idx on public.conversations (created_at desc);

-- ---------- messages (encrypted blobs) ----------
create table public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_hash text not null check (char_length(author_hash) = 64),
  author_username citext not null,
  iv text not null check (char_length(iv) between 16 and 200),
  cipher text not null check (char_length(cipher) between 1 and 10000),
  created_at timestamptz not null default now()
);

create index messages_conversation_created_at_idx
  on public.messages (conversation_id, created_at asc);

-- ---------- groups (metadata public, content encrypted under symmetric key) ----------
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null check (char_length(owner_hash) = 64),
  owner_username citext not null,
  name text not null check (char_length(name) between 1 and 80),
  topic text not null check (char_length(topic) between 1 and 180),
  intro_iv text not null check (char_length(intro_iv) between 16 and 200),
  intro_cipher text not null check (char_length(intro_cipher) between 1 and 10000),
  member_count integer not null default 1 check (member_count >= 1),
  created_at timestamptz not null default now()
);

create index groups_created_at_idx on public.groups (created_at desc);
create index groups_owner_hash_idx on public.groups (owner_hash);

-- ---------- RLS: deny-by-default on every table ----------
-- service_role bypasses RLS entirely, so the Worker is unaffected.
-- The anon and authenticated roles get no access here.

alter table public.users enable row level security;
alter table public.posts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.groups enable row level security;

-- Force RLS even for table owner roles to prevent accidental bypass.
alter table public.users force row level security;
alter table public.posts force row level security;
alter table public.conversations force row level security;
alter table public.messages force row level security;
alter table public.groups force row level security;

-- Explicitly revoke direct grants so PostgREST cannot reach these tables
-- with the anon or authenticated role.
revoke all on public.users from anon, authenticated;
revoke all on public.posts from anon, authenticated;
revoke all on public.conversations from anon, authenticated;
revoke all on public.messages from anon, authenticated;
revoke all on public.groups from anon, authenticated;
