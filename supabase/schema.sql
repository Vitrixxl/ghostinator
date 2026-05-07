-- Ghostinator — schéma Postgres complet (à exécuter dans le SQL Editor Supabase)
-- Version 2 (2026-05-07) : passage à Ed25519 + X25519 (cf. ADR-0003).
-- Idempotent : peut être ré-exécuté sans casser une base existante.

create extension if not exists pgcrypto;
create extension if not exists citext;

create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  username citext unique not null check (
    char_length(username) between 2 and 32 and username ~ '^[a-zA-Z0-9_.\-]+$'
  ),
  public_hash text unique not null check (char_length(public_hash) = 64),
  public_key_ed25519 text not null check (char_length(public_key_ed25519) <= 256),
  public_key_x25519 text not null check (char_length(public_key_x25519) <= 256),
  created_at timestamptz not null default now()
);

-- Migration : si la table existe déjà avec les anciennes colonnes (`public_key`),
-- on ajoute les nouvelles colonnes en renommant.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'users' and column_name = 'public_key'
  ) then
    alter table public.users add column if not exists public_key_ed25519 text;
    alter table public.users add column if not exists public_key_x25519 text;
    -- Pour la dev migration : copie l'ancien public_key dans le champ ed25519.
    -- À ajuster en prod selon la stratégie de re-onboarding.
    update public.users set public_key_ed25519 = coalesce(public_key_ed25519, public_key);
    update public.users set public_key_x25519 = coalesce(public_key_x25519, public_key);
    alter table public.users drop column public_key;
  end if;
end$$;

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
  peer_public_key_x25519 text not null check (char_length(peer_public_key_x25519) <= 256),
  created_at timestamptz not null default now(),
  unique (owner_hash, peer_hash)
);

-- Migration conversations : renomme peer_public_key -> peer_public_key_x25519 si besoin
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversations'
      and column_name = 'peer_public_key'
  ) and not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'conversations'
      and column_name = 'peer_public_key_x25519'
  ) then
    alter table public.conversations rename column peer_public_key to peer_public_key_x25519;
  end if;
end$$;

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

-- Conversations / messages : SELECT publique pour permettre les abonnements
-- Realtime côté client. Le contenu reste E2EE (X25519+AES-GCM) — sans la clé
-- privée du destinataire, le cipher est inutilisable. Trade-off métadonnée
-- explicité dans docs/tensions.md (§Tension 5). Les ÉCRITURES restent bloquées,
-- elles ne passent que par le service role via le Worker (vérification Ed25519).
drop policy if exists "public can read messages metadata" on public.messages;
create policy "public can read messages metadata"
  on public.messages for select
  using (true);

drop policy if exists "public can read conversations metadata" on public.conversations;
create policy "public can read conversations metadata"
  on public.conversations for select
  using (true);

-- Activer Realtime (publication logique) sur les tables où le push est utile.
-- idempotent : ne ré-ajoute pas si déjà présent.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'posts'
  ) then
    alter publication supabase_realtime add table public.posts;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'conversations'
  ) then
    alter publication supabase_realtime add table public.conversations;
  end if;
end$$;
