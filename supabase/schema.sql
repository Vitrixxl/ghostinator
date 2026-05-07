create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username citext unique not null check (
    char_length(username) between 2 and 32 and username ~ '^[a-zA-Z0-9_.\-]+$'
  ),
  public_hash text unique not null check (char_length(public_hash) = 64),
  public_key text not null check (char_length(public_key) <= 256),
  created_at timestamptz not null default now()
);

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_username citext not null,
  author_hash text not null check (char_length(author_hash) = 64),
  body text not null check (char_length(body) <= 280),
  replies integer not null default 0 check (replies >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null check (char_length(owner_hash) = 64),
  peer_hash text not null check (char_length(peer_hash) = 64),
  peer_username citext not null,
  peer_public_key text not null check (char_length(peer_public_key) <= 256),
  created_at timestamptz not null default now(),
  unique (owner_hash, peer_hash)
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_hash text not null check (char_length(author_hash) = 64),
  author_username citext not null,
  iv text not null check (char_length(iv) <= 200),
  cipher text not null check (char_length(cipher) <= 10000),
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null check (char_length(owner_hash) = 64),
  owner_username citext not null,
  name text not null check (char_length(name) <= 80),
  topic text not null check (char_length(topic) <= 180),
  intro_iv text not null check (char_length(intro_iv) <= 200),
  intro_cipher text not null check (char_length(intro_cipher) <= 10000),
  member_count integer not null default 1 check (member_count >= 1),
  created_at timestamptz not null default now()
);

create index if not exists users_username_idx on public.users (username);
create index if not exists users_public_hash_idx on public.users (public_hash);
create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_author_hash_idx on public.posts (author_hash);
create index if not exists conversations_owner_hash_idx on public.conversations (owner_hash);
create index if not exists conversations_peer_hash_idx on public.conversations (peer_hash);
create index if not exists conversations_created_at_idx on public.conversations (created_at desc);
create index if not exists messages_conversation_id_created_at_idx on public.messages (conversation_id, created_at asc);
create index if not exists groups_created_at_idx on public.groups (created_at desc);

alter table public.users enable row level security;
alter table public.posts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.groups enable row level security;

drop policy if exists "public can read users directory" on public.users;
create policy "public can read users directory"
  on public.users for select
  using (true);

drop policy if exists "public can read posts" on public.posts;
create policy "public can read posts"
  on public.posts for select
  using (true);

drop policy if exists "public can read groups metadata" on public.groups;
create policy "public can read groups metadata"
  on public.groups for select
  using (true);

-- Writes and private reads go through the Cloudflare Worker with SUPABASE_SERVICE_ROLE_KEY.
-- The directory exposes only username, public_hash, public_key — no civic identity.
