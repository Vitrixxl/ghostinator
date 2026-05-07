# Ghostinator

PWA React + Tailwind — réseau social anonyme à correspondance chiffrée.

- Front PWA sur Cloudflare Pages
- API sur Cloudflare Workers
- BDD Supabase Postgres
- Posts publics signés par hash de clé publique (pas chiffrés)
- DM chiffrés par paire de clés ECDH P-256 + AES-GCM, dérivés côté client
- Groupes chiffrés sous une clé symétrique partagée hors-bande
- Le Worker et Supabase ne voient que `iv` + `cipher` pour le contenu privé

## Démarrage local

```sh
npm install
cp .env.example .env       # puis renseigner SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY
npm run dev
```

URLs :

- Web : http://127.0.0.1:5173
- API : http://127.0.0.1:8787 (fallback JSON local si `.env` non rempli)

Sans `.env`, l'API tourne en mode JSON sur disque (`data/ghostinator.json`).

## Documentation

- **[docs/supabase.md](docs/supabase.md)** — setup complet Supabase sur une machine vierge (création projet, migration, RLS, smoke test).
- **[docs/cloudflare.md](docs/cloudflare.md)** — déploiement Worker + Pages, secrets, variables, vérification.

## Architecture

| Couche | Outil | Fichier(s) |
|---|---|---|
| Front | Vite + React 19 + Tailwind | `src/` |
| Cryptographie | WebCrypto (ECDH P-256 + AES-GCM) | `src/lib/crypto.ts` |
| Client API | fetch | `src/lib/api.ts` |
| API edge | Cloudflare Worker | `worker/src/index.js` |
| API dev | Express (fallback Supabase ou JSON) | `server/index.js` |
| BDD | Supabase Postgres + RLS forcée | `supabase/migrations/` |

## Sécurité (résumé)

- Aucune authentification email/mot de passe : l'identité **est** la paire de clés ECDH générée localement à l'inscription. La clé privée vit dans `localStorage`.
- Côté Supabase : RLS activée et forcée sur les 5 tables ; `revoke all` pour `anon` et `authenticated`. Seul le `service_role` (utilisé exclusivement par le Worker) peut atteindre la BDD via PostgREST.
- Le serveur ne reçoit **que** les ciphertexts. Les clés AES sont dérivées côté client via ECDH avant chaque écriture, et redérivées à chaque lecture.

## Scripts

| Commande | Effet |
|---|---|
| `npm run dev` | API + front en parallèle |
| `npm run dev:api` | Express seulement |
| `npm run dev:web` | Vite seulement |
| `npm run build` | tsc + vite build → `dist/` |
| `npm run preview` | serve `dist/` localement |
| `npm run cf:dev` | Worker en mode wrangler local |
| `npm run cf:deploy` | déploie le Worker |
