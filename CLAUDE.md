# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commandes

- `bun install` — dépendances (utiliser bun, pas npm)
- `bun run dev` — lance en parallèle l'API Express (`127.0.0.1:8787`) et Vite (`127.0.0.1:5173`) via `concurrently`
- `bun run dev:web` / `bun run dev:api` — chacun isolément
- `bun run build` — `tsc -b && vite build` (sortie dans `dist/`)
- `bun run preview` — sert le build sur `127.0.0.1:4173`
- `bun run cf:dev` — exécute le Worker en local (`wrangler dev` sur `:8787`) au lieu de l'API Express
- `bun run cf:deploy` — déploie le Worker Cloudflare (`wrangler deploy`)

Pas de suite de tests dans le dépôt. Avant de pousser, lancer au moins `bun run build` pour vérifier le typage TS.

## Architecture

Réseau social anonyme PWA avec serveur volontairement aveugle. Trois contrats de confidentialité explicites : posts publics, DM chiffrés bout à bout, groupes chiffrés par clé symétrique locale.

### Deux backends interchangeables, mêmes routes

L'API existe en double :

- `server/index.js` — Express, dev local. Bascule entre persistance JSON (`data/ghostinator.json`, seedé automatiquement) et Supabase si `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` sont présents dans `.env`.
- `worker/src/index.js` — Cloudflare Worker (production). Toujours Supabase, parle directement à l'API REST PostgREST avec la service role key (pas `@supabase/supabase-js` car non-Node).

**Toute modification d'une route ou d'un validateur doit être appliquée des deux côtés.** Les helpers `requireUsername` / `requireHash` / `encryptedPayload` sont dupliqués. Le shape de réponse (`mapUser`, `mapPost`, `mapMessage`, `mapConversation`, `mapGroup`) doit rester strictement identique pour que `src/lib/api.ts` fonctionne contre l'un comme l'autre.

Routes : `GET /health`, `GET /api/bootstrap?owner=<hash>`, `POST|GET /api/users`, `GET /api/users/:hash`, `POST /api/posts`, `POST /api/conversations`, `POST /api/conversations/:id/messages`, `POST /api/groups`.

### Chiffrement (le cœur du projet)

`src/lib/crypto.ts` est la frontière de confidentialité. Le Worker/serveur ne reçoit jamais que `{iv, cipher}` base64 et des métadonnées publiques (username, hash de clé publique).

- Identité : keypair ECDH P-256, stockée en localStorage sous `ghostinator:identity:v3` (`IDENTITY_KEY`). `publicHash = sha256(rawPublicKey)` — c'est l'identifiant public utilisé partout côté serveur.
- DM : `encryptForPeer` / `decryptFromPeer` dérivent une clé AES-GCM 256 par paire via ECDH (clé privée locale + clé publique du pair récupérée du registre). Pas d'état persistant côté serveur, ré-derivé à chaque message.
- Groupes : clé AES-GCM symétrique générée localement, stockée sous `ghostinator:group-key:<groupId>`. Le serveur ne reçoit que le ciphertext de l'intro et le chiffrement des messages — il n'y a aucun mécanisme de partage de clé groupe entre clients (les groupes sont actuellement locaux à leur créateur).

Si tu touches au format d'identité (`IDENTITY_KEY`), incrémenter le suffixe (`:v4`) plutôt que muter en place — la version `:v3` est déjà en circulation.

### Schéma Supabase (`supabase/schema.sql`)

RLS activé sur toutes les tables. Politiques publiques en lecture sur `users`, `posts`, `groups` uniquement. Les écritures et la lecture des `conversations`/`messages` passent obligatoirement par la service role key (Worker ou Express en mode Supabase) — c'est ce qui garde la séparation public/privé même si les RLS publiques fuient.

Contraintes côté DB qui doivent matcher la validation côté API : `username` 2–32 chars regex `^[a-zA-Z0-9_.\-]+$` (citext, donc unique case-insensitive), `public_hash` exactement 64 hex chars, `body` post ≤ 280, `cipher` ≤ 10000, `iv` ≤ 200, `peer_public_key` / `public_key` ≤ 256.

L'utilisateur s'occupe lui-même des migrations Supabase : ne pas exécuter `schema.sql` ni `supabase migration` automatiquement.

### Front (`src/`)

- `App.tsx` — root, machine d'état `boot → onboard → ready`, routing par `window.location.hash` (`feed`/`chat`/`groups`/`dossier`).
- `lib/api.ts` — wrapper `fetch` typé contre `VITE_API_URL` (vide en dev, le proxy Vite redirige `/api` et `/health` vers `127.0.0.1:8787`).
- `components/Layout.tsx` — `Shell` avec rail latéral (lg:) + bottom nav (mobile). Le `rightRail` (xl:) accueille le panneau de recherche d'utilisateurs.
- Tailwind `tailwind.config.js` définit la palette "cipher bureau" (paper/cream/vellum/ink/stamp/cipher…) et trois familles de fontes (Fraunces display, Newsreader serif, JetBrains Mono). Les utilitaires métier (`leaf`, `kicker`, `dispatch-no`, `masthead`, `btn`, `btn-stamp`, `field`, `sigil`, `dropcap`, `fleuron`) vivent dans `src/index.css` sous `@layer components` — préférer ces classes plutôt que d'empiler des utilitaires Tailwind quand on touche au style existant.

### Configuration

- Dev : `cp .env.example .env`. `VITE_API_URL` doit être vide en local pour que le proxy Vite fonctionne (sinon les requêtes contournent le proxy). En production Pages, `VITE_API_URL=https://ghostinator-api.<sub>.workers.dev`.
- Worker : `SUPABASE_URL` dans `wrangler.toml` (`[vars]`), `SUPABASE_SERVICE_ROLE_KEY` en secret (`wrangler secret put`).
- `compatibility_date` du Worker est figé à `2026-05-07` ; le bumper en même temps que tout passage à une nouvelle API Cloudflare.
