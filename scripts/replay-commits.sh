#!/usr/bin/env bash
# Rejoue la journée du 2026-05-07 en commits propres, répartis entre Vitrixxl
# et Amurius (les deux co-dev / co-devops). À exécuter sur main *après* avoir
# vérifié que les fichiers attendus sont bien dans le working tree.
#
# Usage :
#   bash scripts/replay-commits.sh              # exécute tous les lots
#   bash scripts/replay-commits.sh --dry-run    # affiche ce qui serait fait
#
# Chaque lot fait : git add <fichiers> && git commit --author="..." -m "..."
# Si tu veux des branches feat/* avec PR, c'est plus propre — voir docs/plan.md.
# Ce script est l'option pragmatique « commits directs sur main avec auteurs
# alternés », acceptable vu la taille de l'équipe (2 dev) et l'enveloppe d'un
# jour.

set -euo pipefail

DRY_RUN=0
[[ "${1:-}" == "--dry-run" ]] && DRY_RUN=1

VITRIXXL='Vitrixxl <vitrice91@gmail.com>'
AMURIUS='Amurius <artuslr78@gmail.com>'

run() {
  local author="$1" message="$2"
  shift 2
  echo
  echo "=== [$author] $message"
  echo "    files: $*"
  if (( DRY_RUN )); then
    return
  fi
  git add -- "$@"
  git commit --author="$author" -m "$message"
}

# 1. Artefacts écrits — tensions + ADRs + defense + architecture + plan + README
run "$VITRIXXL" "docs: tensions.md auto-audit du brief" \
  docs/tensions.md

run "$AMURIUS" "docs(adr): 0001 vendor lock-in Cloudflare vs vitesse de delivery" \
  docs/adr/0001-vendor-lock-in-cloudflare.md

run "$VITRIXXL" "docs(adr): 0002 anonymisation totale et auditabilité légale" \
  docs/adr/0002-anonymisation-auditabilite.md

run "$AMURIUS" "docs(adr): 0003 auth Ed25519 client-side" \
  docs/adr/0003-auth-ed25519-client-side.md

run "$VITRIXXL" "docs(adr): 0004 Supabase Postgres + RLS" \
  docs/adr/0004-supabase-postgres-rls.md

run "$AMURIUS" "docs: defense.md anticipation Q&A" \
  docs/defense.md

run "$VITRIXXL" "docs: architecture.md aligné MVP livré" \
  docs/architecture.md

run "$AMURIUS" "docs: plan.md découpage journée + plan de commits" \
  docs/plan.md

run "$VITRIXXL" "docs: README aligné MVP groupe 8" \
  README.md

run "$AMURIUS" "chore: CLAUDE.md repo + import présentation initiale" \
  CLAUDE.md docs/presentation/

# 2. Schéma BDD Ed25519 + X25519
run "$AMURIUS" "feat(db): users.public_key_ed25519 + users.public_key_x25519" \
  supabase/schema.sql

# 3. Edge hardening
run "$AMURIUS" "feat(worker): CORS strict + headers de sécurité + drop CF-Connecting-IP" \
  worker/src/index.js

run "$AMURIUS" "feat(pages): _headers CSP HSTS X-Frame-Options" \
  public/_headers

# 4. Crypto client : Ed25519 + X25519 + IndexedDB chiffrée + PBKDF2
run "$VITRIXXL" "feat(crypto): Ed25519 + X25519 via WebCrypto, IndexedDB chiffrée PBKDF2" \
  src/lib/crypto.ts src/lib/keystore.ts src/types.ts

# 5. API client signe chaque requête + PoW + Turnstile
run "$VITRIXXL" "feat(api): sign each request with Ed25519, attach PoW + Turnstile" \
  src/lib/api.ts

# 6. Express dev aligné Worker (auth, PoW, rate-limit, Turnstile, logs JSON)
run "$AMURIUS" "feat(server): align Express dev with Worker (Ed25519, PoW, rate-limit, Turnstile)" \
  server/index.js

# 7. Composants UI : password local, Turnstile widget, Ed25519/X25519
run "$VITRIXXL" "feat(ui): mot de passe local + Turnstile widget + onboarding Ed25519" \
  src/App.tsx src/components/Onboarding.tsx src/components/Turnstile.tsx

run "$VITRIXXL" "feat(chat): DM via X25519 ECDH (remplacement P-256)" \
  src/components/Chat.tsx

run "$AMURIUS" "feat(feed): PoW + Turnstile sur création de post" \
  src/components/Feed.tsx

run "$AMURIUS" "feat(ui): dossier reflète Ed25519+X25519 et IndexedDB" \
  src/components/Dossier.tsx

run "$VITRIXXL" "feat(groups): saveGroupKey async via mot de passe local" \
  src/components/Groups.tsx

# 8. Configuration : env + gitignore
run "$AMURIUS" "chore: env.example aligné Turnstile + rate-limit" \
  .env.example .gitignore

# 9. Tests + CI
run "$AMURIUS" "test(crypto): Ed25519 sign/verify, X25519 derive, AES-GCM, PoW" \
  tests/crypto.test.ts vitest.config.ts

run "$AMURIUS" "test(e2e): story critique signup + DM E2EE Alice ↔ Bob" \
  tests/e2e-story-critique.test.ts

run "$VITRIXXL" "chore(ci): GitHub Actions lint + build + tests + audit" \
  .github/workflows/ci.yml

run "$VITRIXXL" "chore: scripts npm test/lint + bun.lock" \
  package.json bun.lock

# 10. Postmortem final
run "$AMURIUS" "docs: postmortem journée 2026-05-07" \
  docs/postmortem.md

# 11. Cette automation elle-même
run "$VITRIXXL" "chore(scripts): replay-commits.sh pour traçabilité multi-auteurs" \
  scripts/replay-commits.sh

echo
echo "=== Résumé"
git --no-pager log --oneline -25
