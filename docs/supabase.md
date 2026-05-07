# Supabase setup

Procédure pour brancher Ghostinator sur un projet Supabase, depuis une machine vierge.

## Prérequis

- Node 20+ et npm
- Un compte Supabase (gratuit suffit)
- `psql` côté local (Linux : `sudo pacman -S postgresql` ou `apt install postgresql-client`).
  Alternative : la CLI Supabase via `npx supabase` — pas d'install nécessaire.

## 1. Récupérer le repo

```sh
git clone git@github.com:Vitrixxl/ghostinator.git
cd ghostinator
npm install
```

## 2. Créer le projet Supabase

1. Aller sur https://supabase.com → *New project*.
2. Choisir une région **proche du Worker Cloudflare**. Pour la France/EU, `eu-west-1` ou `eu-west-3`. La région détermine l'URL du *pooler*.
3. Définir un mot de passe Postgres (copie-le, on en a besoin pour la migration).

## 3. Récupérer les identifiants

Dans le dashboard du projet :

- **Project URL** — *Project Settings → API* → bloc *Project URL*. Format : `https://<ref>.supabase.co`.
- **Secret API key** — *Project Settings → API* → bloc *Project API keys* → ligne **`secret`** (format `sb_secret_...`).
  La clé `service_role` (legacy, JWT) fonctionne aussi.
- **Connection string** — *Project Settings → Database* → bloc *Connection string* → onglet **URI**. Prendre la version *Session pooler* (port 5432) ou *Transaction pooler* (port 6543) — le pooler est en IPv4, le *Direct connection* est IPv6-only sur le free tier.

  Format pooler :
  ```
  postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
  ```

⚠️ La password contient souvent des caractères spéciaux (`@`, `!`, `#`, …). Il faut les **URL-encoder** dans la connection string :

| Caractère | Encodé |
|---|---|
| `@` | `%40` |
| `!` | `%21` |
| `#` | `%23` |
| `$` | `%24` |
| `&` | `%26` |
| `:` | `%3A` |

## 4. Appliquer la migration

Le schéma est dans `supabase/migrations/<timestamp>_init_schema.sql`.

**Option A — psql (rapide) :**

```sh
psql "postgresql://postgres.<ref>:<password-encoded>@aws-0-<region>.pooler.supabase.com:6543/postgres?sslmode=require" \
  -v ON_ERROR_STOP=1 \
  -f supabase/migrations/*_init_schema.sql
```

**Option B — Supabase CLI :**

```sh
npx supabase db push --db-url "postgresql://postgres.<ref>:<password-encoded>@aws-0-<region>.pooler.supabase.com:6543/postgres" --yes
```

> Note : si la DB n'est pas vierge (tables `public.users` etc. déjà présentes d'un précédent essai), il faut soit les drop d'abord, soit générer une migration de delta. Pour un projet neuf, c'est sans objet.

**Vérification :**

```sh
psql "$URL" -c "select tablename from pg_tables where schemaname='public' order by tablename;"
```

Tu dois voir : `conversations`, `groups`, `messages`, `posts`, `users`.

```sh
psql "$URL" -c "select c.relname, c.relrowsecurity, c.relforcerowsecurity from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r';"
```

Les 5 tables doivent avoir `rls_enabled=t` et `rls_forced=t`.

## 5. Configurer `.env`

À la racine du projet :

```sh
cp .env.example .env
```

Puis éditer `.env` :

```
PORT=8787
VITE_API_URL=http://127.0.0.1:8787
SUPABASE_URL=https://<ref>.supabase.co
SUPABASE_SERVICE_ROLE_KEY=sb_secret_xxxxxxxxxxxxxxxxxxxx
```

Le nom de la variable est `SUPABASE_SERVICE_ROLE_KEY` pour rétro-compatibilité, mais le code accepte aussi bien la clé legacy (`eyJ...`) que la nouvelle clé secrète (`sb_secret_...`).

## 6. Smoke test local

```sh
npm run dev:api
# dans un autre terminal :
curl http://127.0.0.1:8787/health
# attendu : {"ok":true,"db":"supabase",...}

curl -X POST http://127.0.0.1:8787/api/users \
  -H "content-type: application/json" \
  -d '{"username":"smoke","publicHash":"'$(printf '0%.0s' {1..64})'","publicKey":"BLOB"}'
# attendu : 201 + l'objet user

# Cleanup :
psql "$URL" -c "delete from public.users where username='smoke';"
```

Si tout passe, lance le front :

```sh
npm run dev
```

→ http://127.0.0.1:5173

## Posture sécurité

Le schéma applique :

- RLS activée **et forcée** sur les 5 tables (même les rôles propriétaires ne peuvent pas la bypasser).
- `revoke all on public.<table> from anon, authenticated` — la clé `anon` (publique) ne peut **rien** lire ni écrire.
- Toutes les écritures et lectures passent par le Cloudflare Worker avec la clé `secret` / `service_role`, qui bypasse RLS.

Concrètement : si la clé `anon` (qui est destinée à être publique) fuite, l'attaquant ne peut atteindre aucune donnée. Le seul vecteur d'accès est le Worker, qui valide chaque requête côté `worker/src/index.js`.
