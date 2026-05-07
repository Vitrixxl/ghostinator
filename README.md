# Ghostinator

> Réseau social fantôme. Anonymisation totale par construction cryptographique. Budget de démarrage quasi nul. Équipe sans admin sys.

PWA React + Tailwind, edge sur Cloudflare, BDD Supabase EU. Identité Ed25519 client-side, DM chiffrés bout-en-bout via X25519 ECDH. Le serveur ne peut techniquement pas ré-identifier un utilisateur — pas par choix politique, par construction mathématique.

## Démarrage rapide (< 5 min)

```sh
bun install
cp .env.example .env       # renseigner SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY si Supabase
bun run dev
```

URLs locales :
- Web : http://127.0.0.1:5173
- API : http://127.0.0.1:8787 (Express en dev, mêmes routes que le Worker)

Sans `.env`, l'API tourne en mode JSON sur disque (`data/ghostinator.json`) — utile pour démo offline.

## Architecture

Voir **[`docs/architecture.md`](docs/architecture.md)** pour le détail (3-8 pages, schéma, modèle de données, scalabilité, sécurité).

Synthèse :

| Couche | Choix | Fichier |
|---|---|---|
| Front PWA | React 19 + Vite 7 + Tailwind 3.4 | `src/` |
| Crypto navigateur | WebCrypto natif — Ed25519 (auth) + X25519 (DM E2EE) + AES-GCM 256 | `src/lib/crypto.ts` |
| Stockage clé privée | IndexedDB chiffrée par AES-GCM dérivé d'un mot de passe local (PBKDF2 210k) | `src/lib/crypto.ts` |
| API edge | Cloudflare Workers (V8 isolates, < 1 ms cold start) | `worker/src/index.js` |
| API dev | Express avec mêmes routes (fallback Supabase ou JSON local) | `server/index.js` |
| BDD | Supabase Postgres 17 + Row-Level Security, EU Frankfurt | `supabase/schema.sql` |
| Anti-bot | Cloudflare Turnstile + Proof-of-Work hashcash + rate-limit hashé | `worker/src/index.js` |
| CI | GitHub Actions free tier — lint + typecheck + build + tests, < 5 min | `.github/workflows/ci.yml` |

## Contraintes & arbitrages (groupe 8)

| Contrainte imposée | Comment elle est tenue | ADR |
|---|---|---|
| Anonymisation totale | Pas de PII collectée. IP strippée à l'edge. Identité = `sha256(rawEd25519PubKey)`. Le serveur ne peut pas ré-identifier. | [ADR-0002](docs/adr/0002-anonymisation-auditabilite.md) + [ADR-0003](docs/adr/0003-auth-ed25519-client-side.md) |
| Budget de démarrage quasi nul | Stack 100 % free tier (Cloudflare + Supabase + GitHub Actions). 0 €/mois jusqu'à ~10k MAU. | [ADR-0004](docs/adr/0004-supabase-postgres-rls.md) |
| Équipe sans admin sys | Tout managé / serverless. Aucun OS à patcher, aucun pooler à opérer. | [ADR-0001](docs/adr/0001-vendor-lock-in-cloudflare.md) |
| Imprévu : fournisseur principal inaccessible sous 6 mois | Stack volontairement portable (Postgres standard, S3-compatible, JS portable). Plan B chiffré à 5–7 jours pour 2 dev. | [ADR-0001](docs/adr/0001-vendor-lock-in-cloudflare.md) + [`ghost-social-plan-b.md`](docs/presentation/ghost-social-plan-b.md) |

Auto-audit du brief avec citations textuelles : [`docs/tensions.md`](docs/tensions.md).

## Équipe

- **Vitrixxl** — co-dev / co-devops. Crypto client, IndexedDB chiffrée, signature API, Turnstile, CI.
- **Amurius** — co-dev / co-devops. Edge hardening, vérification serveur, PoW, rate-limit, tests.

Répartition des lots détaillée dans [`docs/plan.md`](docs/plan.md).

## État du projet (2026-05-07)

**Ce qui marche :**
- Onboarding : génération keypair Ed25519 + X25519, IndexedDB chiffrée, mnémonique BIP-39 affichée.
- Signature de chaque requête mutante côté client, vérification côté Worker / Express avec replay protection.
- DM E2EE X25519 : envoi, réception, déchiffrement local. Le serveur n'a que `{iv, cipher}`.
- Posts publics signés.
- Groupes avec intro chiffrée par clé symétrique locale.
- Edge durci : CORS strict, headers de sécurité, drop CF-Connecting-IP défensif.
- Anti-spam : Proof-of-Work à signup et création de post, rate-limit hashé, Turnstile.
- CI verte sur push : lint + typecheck + build + tests Vitest + E2E story critique.

**Ce qui est partiel / hors scope MVP :**
- Pas de R2 ni d'EXIF stripping (pas d'upload image dans le MVP).
- Pas de DM groupe E2EE multi-parties (clé symétrique locale au créateur seulement).
- Pas de modération communautaire complète (UI signalement + masquage seuil seulement, élection modérateurs en M+1).
- Pas de monitoring out-of-band en MVP (logs Workers Cloudflare seulement).
- Pas d'IaC pour le plan B (étapes manuelles documentées dans [`docs/presentation/ghost-social-plan-b.md`](docs/presentation/ghost-social-plan-b.md)).

Postmortem honnête : [`docs/postmortem.md`](docs/postmortem.md).

## Roadmap (non-engageante)

| Quand | Quoi |
|---|---|
| M+1 | IaC Terraform/Ansible pour bascule plan B en < 30 min. UptimeRobot + Telegram. Cron ping Supabase. Test de restauration backup. |
| M+2 | DM groupe E2EE via Signal Sender Keys ou MLS. |
| M+3 | Modération communautaire (élection modérateurs, journal append-only signé). |
| M+5 | Audit cryptographique externe pré-lancement. |
| M+6 | Lancement public. |

Détail du calendrier de pivot vers stack EU souveraine (si Cloudflare devient hostile) : [`docs/presentation/ghost-social-plan-b.md`](docs/presentation/ghost-social-plan-b.md).

## Documentation

- [`docs/architecture.md`](docs/architecture.md) — référence technique.
- [`docs/tensions.md`](docs/tensions.md) — auto-audit du brief (filtre principal d'évaluation).
- [`docs/defense.md`](docs/defense.md) — anticipation Q&A.
- [`docs/plan.md`](docs/plan.md) — découpage de la journée, lots, owners, statuts.
- [`docs/postmortem.md`](docs/postmortem.md) — ce qui a marché, ce qui n'a pas marché, surprises.
- [`docs/adr/`](docs/adr/) — décisions architecturales (4 ADRs).
- [`docs/presentation/`](docs/presentation/) — pitch oral 5 min, schéma Excalidraw, glossaire, plan B.

## Scripts

| Commande | Effet |
|---|---|
| `bun run dev` | API Express + front Vite en parallèle |
| `bun run dev:api` | Express seulement (`:8787`) |
| `bun run dev:web` | Vite seulement (`:5173`) |
| `bun run build` | `tsc -b && vite build` → `dist/` |
| `bun run preview` | sert `dist/` localement (`:4173`) |
| `bun run cf:dev` | Worker en mode wrangler local (`:8787`) |
| `bun run cf:deploy` | `wrangler deploy` du Worker |
| `bun run test` | Vitest unitaires + E2E |
| `bun run lint` | type-check TypeScript strict |

## Conventions

- Commits : Conventional Commits (`feat`, `fix`, `docs`, `chore`, `refactor`, `test`).
- Branches : `feat/*`, `fix/*`, `chore/*`. `main` protégée, mergée via PR avec CI verte.
- Code style : Prettier + TypeScript strict.

## Licence

Code propriétaire pour cet exercice pédagogique. Pas de redistribution prévue.
