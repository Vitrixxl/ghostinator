# Ghostinator

PWA React + Tailwind pour réseau social anonyme:

- front PWA sur Cloudflare Pages;
- API sur Cloudflare Workers;
- BDD Supabase Postgres;
- posts publics liés à `hash(pubkey)`;
- conversations et groupes chiffrés côté navigateur avec WebCrypto;
- le Worker et Supabase stockent seulement métadonnées publiques + `iv/cipher`.

## Local

```sh
npm install
cp .env.example .env
npm run dev
```

URLs locales:

- Web: `http://127.0.0.1:5173`
- API Express dev fallback: `http://127.0.0.1:8787`

## Supabase

1. Créer un projet Supabase.
2. Exécuter [supabase/schema.sql](/home/vitrix/dev/ghostinator/supabase/schema.sql) dans SQL Editor.
3. Mettre `SUPABASE_URL` et `SUPABASE_SERVICE_ROLE_KEY` dans `.env` pour le dev local.

## Cloudflare Workers API

```sh
wrangler secret put SUPABASE_SERVICE_ROLE_KEY
wrangler deploy
```

Mettre la vraie `SUPABASE_URL` dans [wrangler.toml](/home/vitrix/dev/ghostinator/wrangler.toml).

## Cloudflare Pages

Build command:

```sh
npm run build
```

Output directory:

```text
dist
```

Variable Pages:

```text
VITE_API_URL=https://ghostinator-api.<subdomain>.workers.dev
```
