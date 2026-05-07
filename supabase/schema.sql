create extension if not exists pgcrypto;

create table if not exists public.posts (
  id uuid primary key default gen_random_uuid(),
  author_handle text not null check (char_length(author_handle) <= 80),
  author_hash text not null check (char_length(author_hash) <= 128),
  body text not null check (char_length(body) <= 280),
  replies integer not null default 0 check (replies >= 0),
  created_at timestamptz not null default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null check (char_length(owner_hash) <= 128),
  peer_handle text not null check (char_length(peer_handle) <= 80),
  peer_hash text not null check (char_length(peer_hash) <= 128),
  created_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  author_hash text not null check (char_length(author_hash) <= 128),
  author_handle text not null check (char_length(author_handle) <= 80),
  iv text not null check (char_length(iv) <= 200),
  cipher text not null check (char_length(cipher) <= 10000),
  created_at timestamptz not null default now()
);

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  owner_hash text not null check (char_length(owner_hash) <= 128),
  name text not null check (char_length(name) <= 80),
  topic text not null check (char_length(topic) <= 180),
  intro_iv text not null check (char_length(intro_iv) <= 200),
  intro_cipher text not null check (char_length(intro_cipher) <= 10000),
  member_count integer not null default 1 check (member_count >= 1),
  created_at timestamptz not null default now()
);

create index if not exists posts_created_at_idx on public.posts (created_at desc);
create index if not exists posts_author_hash_idx on public.posts (author_hash);
create index if not exists conversations_owner_hash_idx on public.conversations (owner_hash);
create index if not exists conversations_created_at_idx on public.conversations (created_at desc);
create index if not exists messages_conversation_id_created_at_idx on public.messages (conversation_id, created_at asc);
create index if not exists groups_created_at_idx on public.groups (created_at desc);

alter table public.posts enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.groups enable row level security;

drop policy if exists "public can read posts" on public.posts;
create policy "public can read posts"
  on public.posts for select
  using (true);

drop policy if exists "public can read groups metadata" on public.groups;
create policy "public can read groups metadata"
  on public.groups for select
  using (true);

-- Writes and private reads go through the backend with SUPABASE_SERVICE_ROLE_KEY.
-- Client-side Supabase anon access is intentionally not used for encrypted blobs.

insert into public.posts (author_handle, author_hash, body, replies)
values
  (
    'ghost:7f3c9a',
    '7f3c9a8b2d11f7e02019f4d42fd87a4a831b6b6cb8f71f4cc29ad06f5d3d88b3',
    'Prototype PWA anonyme: la clé publique devient le seul identifiant stable. Le serveur voit un post public, pas une identité civile.',
    8
  ),
  (
    'ghost:41b8e0',
    '41b8e0cc9120778ebc6d83a26162a6928df23e82b9afd3ae4602dd73aac15d64',
    'Les conversations doivent être chiffrées avant le réseau. Une base compromise ne devrait exposer que des blobs.',
    21
  ),
  (
    'node:9d03aa',
    '9d03aa742fd984ee4891be93bf3341e66dbbd962f5d929aee726342fdd4acb18',
    'Posts publics, DM privés, groupes chiffrés: trois surfaces différentes, trois contrats de confidentialité explicites.',
    13
  )
on conflict do nothing;

insert into public.groups (owner_hash, name, topic, intro_iv, intro_cipher, member_count)
values
  (
    'demo-owner-hash',
    'Cercle zero-knowledge',
    'Architecture, audits et limites d''un serveur volontairement aveugle.',
    '90d1H2hLrPv4U1ie',
    'v2.demo.group.ciphertext.zero-knowledge-intro',
    12
  ),
  (
    'demo-owner-hash',
    'Agora publique',
    'Posts publics signés par clé, modération sans profil civil.',
    'FvJyA7V0Qh0MB8sN',
    'v2.demo.group.ciphertext-public-agora',
    48
  ),
  (
    'demo-owner-hash',
    'Atelier PWA',
    'Cloudflare Pages, Worker API, service worker et stockage local des clés.',
    'k6i9o1Y+Qbxq5a3L',
    'v2.demo.group.ciphertext-pwa-workshop',
    7
  )
on conflict do nothing;
