# ADR 0004 : Supabase Postgres + Row-Level Security pour le cloisonnement

**Statut :** Accepté
**Date :** 2026-05-07
**Auteurs :** Vitrixxl, Amurius

---

## Contexte

Le produit est un réseau social anonyme : posts publics, DM chiffrés bout-en-bout, groupes chiffrés par clé symétrique locale. Un feed social est un graphe relationnel (utilisateurs × posts × follows × signalements × DM × groupes). Nous avons besoin d'une base qui supporte :

- Des JOIN performants (pour le feed et le directory utilisateurs).
- Des contraintes d'unicité strictes (un username unique case-insensitive, un hash de pubkey unique).
- Du cloisonnement par identité — un utilisateur ne doit lire que ses propres DM, écrire que ses propres posts.
- De la conformité RGPD (chiffrement au repos par défaut, hébergement EU, droit à l'effacement).
- Une trajectoire de scale claire de 0 à 5M MAU sans réécriture.
- Le free tier qui colle avec la contrainte « budget quasi nul ».

---

## Options envisagées

### Option A — Firebase Firestore (Google)

- **Inconvénients :** Firebase Auth exige un identifiant (email, téléphone, OAuth Google/Apple) — incompatible avec ADR-0002. Firestore est un document store, peu adapté aux JOIN d'un feed social. Données hébergées chez Google, juridiction US (Cloud Act). Rejeté.

### Option B — MongoDB Atlas free tier

- **Inconvénients :** 512 MB, pas de Realtime intégré, pas de Row-Level Security native (filtrage applicatif fragile). Document store inadéquat pour le graphe relationnel. Rejeté.

### Option C — Neon ou Supabase ou PlanetScale (free Postgres managé)

Tous proposent du Postgres managé en EU avec free tier généreux.

- **Neon :** très bon Postgres serverless, branching git-like, mais pas de Realtime ni de Storage intégré. Il faudrait recâbler ces deux briques séparément.
- **PlanetScale :** MySQL-compatible (Vitess), pas Postgres. Migration plus tardive coûteuse si on doit basculer (ADR-0001).
- **Supabase :** Postgres 17 managé, 500 MB, RLS native, Realtime via WebSocket inclus, Storage inclus (qu'on n'utilise pas, on a R2), pooler Supavisor inclus, **disponible en région EU Frankfurt explicite**. Free tier suffisant jusqu'à ~10k MAU.

### Option D — Postgres self-hosted sur Hetzner CX23

- **Inconvénients :** contredit la contrainte « équipe sans admin sys ». Patches OS, sauvegardes, monitoring, pooler à opérer manuellement. Garde toutefois sa place comme **plan B activable** (voir ADR-0001).

---

## Décision

**Option C — Supabase Postgres 17 managé, région EU Frankfurt.**

### Schéma logique

Cinq tables, toutes avec contraintes strictes au niveau Postgres (pas seulement applicatif) :

| Table | Rôle | Clés | Contraintes notables |
|---|---|---|---|
| `users` | Directory public des identités | `id` UUID, `public_hash` unique 64 hex, `username` citext unique 2–32 chars | `public_key_ed25519` ≤ 256 chars (raw 32 octets en base64), `public_key_x25519` ≤ 256 chars |
| `posts` | Posts publics chronologiques | `id` UUID, `author_hash` 64 hex | `body` ≤ 280 chars, lien implicite vers `users.public_hash` |
| `conversations` | Métadonnées DM (pas le contenu) | `id` UUID, `(owner_hash, peer_hash)` unique | Cloisonnement RLS par hash |
| `messages` | Blobs chiffrés des DM | `id` UUID, `conversation_id` FK | `iv` ≤ 200 chars, `cipher` ≤ 10000 chars. Le serveur ne sait *jamais* lire le contenu |
| `groups` | Métadonnées + intro chiffrée des groupes | `id` UUID, `owner_hash` 64 hex | `intro_iv` ≤ 200, `intro_cipher` ≤ 10000 |

Schéma complet versionné dans `supabase/schema.sql`.

### Row-Level Security

RLS activé sur toutes les tables. Politiques :

- **`users`, `posts`, `groups`** : `select` public — c'est le contenu public de la plateforme. `insert/update/delete` interdits sauf via service role (Worker/Express avec la signature Ed25519 vérifiée en amont).

- **`conversations`, `messages`** : `select` interdit en public. Seul le service role peut lire — et il ne lit que pour les requêtes où la signature Ed25519 du requêteur prouve qu'il est `owner_hash` ou `peer_hash` de la conversation.

L'invariant de sécurité : même une fuite de la clé `anon` Supabase (qu'on ne devrait pas déployer publiquement, mais on durcit en supposant qu'elle pourrait l'être) ne donne accès qu'au contenu déjà public. Les DM restent chiffrés bout-en-bout, donc inutilisables sans les clés privées des participants — clés qui ne quittent jamais leur navigateur.

### Cloisonnement applicatif via signature Ed25519

Chaque écriture mutante passe par le Worker, qui :

1. Vérifie le timestamp (< 60 s).
2. Vérifie la signature Ed25519 contre la pubkey présente dans `users.public_key_ed25519` pour le `author_hash` revendiqué.
3. Si OK, exécute l'opération avec la service role key.

Le client ne parle *jamais* directement à Supabase — toujours via le Worker, ce qui nous permet de garder la service role en secret backend et d'imposer la vérification de signature en amont.

### Sauvegarde (RPO/RTO)

- **RPO cible :** 24 h. Une perte de moins d'une journée d'écriture est acceptable pour un MVP de réseau social anonyme (pas de transaction financière, pas de chaîne hospitalière).
- **RTO cible :** 4 h. Restauration depuis le dump quotidien Supabase.
- **Stratégie :** Supabase free fait des backups quotidiens automatiques avec rétention 7 jours. À partir du palier Pro (25 $/mois), la rétention passe à 30 jours et on ajoute un dump nightly out-of-band (`pg_dump | rclone scaleway:backups/`) pour ne pas dépendre d'un seul fournisseur. Cette redondance est une dette explicite de la phase post-MVP (voir `docs/plan.md`).
- **Test de restauration :** prévu en M+1 du lancement (cf. `docs/presentation/ghost-social-plan-b.md` §M2). Une sauvegarde non testée n'est pas une sauvegarde.

### Stratégie de scale (rappel ADR-0001 §scalabilité)

| Palier | Goulet | Action | Coût |
|---|---|---|---|
| 0 → 10k MAU | Aucun | Rien | 0 € |
| 10k → 50k MAU | 500 MB Postgres rempli (~500k posts à 1 KB) | Supabase Pro 8 GB + archivage cold des posts > 6 mois vers R2 en Parquet | 25 $/mois |
| 50k → 500k MAU | Writes Postgres saturés | Read-replicas Supabase | ~25 $/mois supplémentaires |
| 500k → 5M MAU | Monolithe write | Partitionnement par `author_hash` (premier caractère hex → 16 partitions) | ~200 $/mois |
| 5M+ MAU | Sharding | Citus extension ou migration Postgres distribué (CockroachDB) | À discuter avec un investisseur |

Chaque palier est un **changement de plan**, pas une réécriture applicative. Le code applicatif n'a pas conscience du palier.

---

## Conséquences

- **Positives :**
  - Postgres standard, totalement portable. Si Supabase devient hostile, migration vers OVHcloud Managed Postgres ou Neon en quelques jours (`pg_dump | psql`). Lock-in faible.
  - RLS Postgres = défense en profondeur. Même un bug applicatif qui contournerait notre couche d'auth ne compromet pas le cloisonnement des DM.
  - Realtime via WebSocket inclus dans Supabase free — utilisable plus tard pour pousser le feed sans recâbler une stack pub/sub.
  - Hébergement EU Frankfurt explicite. RGPD by design pour le stockage.

- **Négatives :**
  - 500 MB du free tier remplis à ~500k posts. Palier de croissance prévu mais qui exige une migration vers le plan Pro à 25 $/mois.
  - Supabase free met le projet en pause après 7 jours d'inactivité. Mitigation : un cron Workers gratuit ping le projet toutes les 24 h pour le maintenir actif. Un seul utilisateur réel suffit aussi à le garder éveillé.
  - Service role key = secret hautement sensible (full access DB). Mitigation : stockée uniquement en `wrangler secret`, jamais en variable Pages, jamais dans le repo.

- **Risques :**
  - Supabase racheté ou change de pricing. Probabilité faible–moyenne, impact moyen. Mitigation : portabilité Postgres, plan B activable en moins d'une semaine.
  - Faille dans une politique RLS. Impact = potentielle fuite de DM (même si chiffrés, leur métadonnées révèlent qui parle à qui). Mitigation : tests d'intégration sur les politiques RLS, audit avant lancement public.
  - Saturation imprévue du free tier sur un pic de trafic (effet Hacker News). Mitigation : alerte sur 80 % d'usage Postgres + Workers, bascule manuelle vers Pro en quelques minutes.

- **Réversibilité :**
  Migration Supabase → autre Postgres managé EU : 1–2 jours pour 2 dev (`pg_dump` + restore + changer la connection string + redéployer). Migration Postgres → autre famille de SGBD (NoSQL, etc.) : plusieurs semaines, schéma à repenser. Donc le risque de lock-in est *à l'intérieur de Postgres*, pas *à l'intérieur de Supabase*. C'est le bon niveau de couplage.
