# Déploiement Cloudflare

Ghostinator se déploie sur deux briques Cloudflare :

- **Workers** — l'API (`worker/src/index.js`)
- **Pages** — le front PWA (build Vite)

## Prérequis

- Compte Cloudflare (plan *Free* OK).
- Supabase déjà configuré (voir [supabase.md](./supabase.md)).
- Wrangler CLI : déjà installé via `npm install` (devDep).

## 1. Authentification

```sh
npx wrangler login
```

Ça ouvre un onglet pour valider la session Cloudflare. Une seule fois par machine.

## 2. Déployer le Worker (l'API)

### 2.1 Configurer `wrangler.toml`

Édite `wrangler.toml` à la racine du repo. Remplace `SUPABASE_URL` par ta vraie URL Supabase :

```toml
name = "ghostinator-api"
main = "worker/src/index.js"
compatibility_date = "2026-05-07"

[vars]
SUPABASE_URL = "https://tdbfzatpjxtxsoxsyyhh.supabase.co"
```

### 2.2 Pousser le secret

⚠️ **Ne mets jamais la clé secrète dans `wrangler.toml`.** Utilise le store de secrets :

```sh
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY
# colle la clé sb_secret_... ou service_role JWT quand demandé
```

### 2.3 Déployer

```sh
npx wrangler deploy
```

À la fin, Wrangler affiche l'URL du Worker, format :
```
https://ghostinator-api.<ton-subdomain>.workers.dev
```

**Note la — on en a besoin pour Pages.**

### 2.4 Vérifier

```sh
curl https://ghostinator-api.<ton-subdomain>.workers.dev/health
# attendu : {"ok":true,"db":"supabase","edge":"cloudflare",...}
```

## 3. Déployer le front (Pages)

Deux options. La première est recommandée pour le long terme.

### Option A — Branchée sur Git (auto-redeploy à chaque push)

1. Dashboard Cloudflare → *Workers & Pages* → *Create* → *Pages* → *Connect to Git*.
2. Choisir le repo `ghostinator`.
3. Build settings :
   - **Framework preset** : `None`
   - **Build command** : `npm run build`
   - **Build output directory** : `dist`
   - **Root directory** : *(vide)*
4. **Environment variables** (Production) :
   - `VITE_API_URL` = `https://ghostinator-api.<ton-subdomain>.workers.dev` *(sans slash final)*
   - `NODE_VERSION` = `20`
5. *Save & Deploy*.

À partir de là, chaque `git push origin main` redéploie automatiquement.

### Option B — Déploiement direct (rapide, pas de branchement Git)

```sh
VITE_API_URL=https://ghostinator-api.<ton-subdomain>.workers.dev npm run build
npx wrangler pages deploy dist --project-name=ghostinator
```

La première fois il crée le projet ; les suivantes il pousse une nouvelle version.

## 4. Vérifier le déploiement complet

1. Ouvrir l'URL Pages (ex. `https://ghostinator.pages.dev`).
2. Tu vois le masthead `GHOSTinATOR` → écran d'onboarding.
3. Choisis un alias → la paire de clés s'affiche → coche *J'ai sauvegardé* → *Entrer au bureau*.
4. Va dans *Trouver un agent* (rail de droite), cherche un autre alias enregistré, ouvre un pli, envoie un message.
5. Vérifie sur Supabase (table editor) que `users`, `messages`, `posts` se peuplent.

## 5. Itérer

| Tu modifies | Tu fais |
|---|---|
| `worker/src/index.js` | `npx wrangler deploy` |
| `supabase/migrations/*` | psql ou `npx supabase db push --db-url ...` |
| Front (`src/**`) | `git push` (Option A) ou `npx wrangler pages deploy dist` (Option B) |
| Une variable serveur | `npx wrangler secret put NOM` |

## 6. Domaine custom (optionnel)

Pages → ton projet → *Custom domains* → *Set up a custom domain* → suivre les instructions DNS.

Worker → l'API n'a généralement pas besoin de domaine custom (l'URL `*.workers.dev` suffit), mais si tu veux : Worker → *Triggers* → *Custom Domains*.

## Checklist anti-piège

- [ ] `wrangler.toml` → `SUPABASE_URL` est l'URL **réelle** de ton projet Supabase, pas le placeholder.
- [ ] `SUPABASE_SERVICE_ROLE_KEY` est uniquement dans `wrangler secret`. Jamais dans le repo, jamais dans Pages env.
- [ ] Pages env → `VITE_API_URL` pointe sur l'URL **Worker** (pas sur l'URL Pages elle-même).
- [ ] La migration Supabase a été appliquée *avant* le premier appel.
- [ ] La clé `anon` n'a aucun GRANT (vérifie dans le dashboard Supabase ou via `\dp public.*` en psql) — sinon RLS forcée sans GRANT veut dire personne ne peut accéder.

## Logs et debug

```sh
npx wrangler tail                    # logs temps réel du Worker
npx wrangler deployments list        # historique des déploiements Worker
npx wrangler pages deployment list --project-name=ghostinator
```

Côté Pages, le dashboard a un onglet *Functions* / *Deployments* qui montre les builds récents et leurs logs.
