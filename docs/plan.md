# Plan de réalisation — journée du 2026-05-07

> Lots de travail, qui s'en charge, statut, dépendances. Détail au demi-jour.

**Auteurs :** Vitrixxl, Amurius

---

## Découpage de la journée

| Plage | Activité dominante |
|---|---|
| 9h00 – 10h00 | Cadrage MVP, scope, premier ADR sur la stack (relecture des ADR rédigés). |
| 10h00 – 12h30 | Setup repo (déjà fait sur les commits précédents) + chemin critique : Ed25519 + X25519 bout-en-bout. |
| 12h30 – 13h30 | Pause. |
| 13h30 – 15h30 | Implémentation périphérique (PoW, rate-limit, Turnstile, IndexedDB) + tests minimaux + CI + déploiement staging + documentation finale. |
| 15h30 – 17h00 | Démos et Q&A. |

---

## Lots de travail

| # | Lot | Owner | Estimé | Statut | Dépend de |
|---|---|---|---|---|---|
| L1 | Artefacts écrits : tensions, ADR-0001/2/3/4, defense, architecture, plan, README enrichi | Vitrixxl + Amurius (co-rédigés) | 1h30 | fait | — |
| L2 | Schéma data : ajout colonnes `public_key_ed25519`, `public_key_x25519` dans `users` (migration `supabase/schema.sql`) | Amurius | 15 min | en cours | L1 |
| L3 | Crypto client : `src/lib/crypto.ts` v4 — Ed25519 + X25519 + IndexedDB chiffrée + PBKDF2 | Vitrixxl | 1h | à faire | L2 |
| L4 | API client : `src/lib/api.ts` — wrapper qui signe chaque requête sortante | Vitrixxl | 30 min | à faire | L3 |
| L5 | Worker + Express : vérification Ed25519, durcissement edge (CORS strict, headers de sécu, drop CF-Connecting-IP) | Amurius | 1h | à faire | L2 |
| L6 | Proof-of-Work signup + post (client + Worker) | Amurius | 1h | à faire | L5 |
| L7 | Rate-limit hashé (Worker, Map en dev, KV en prod) | Amurius | 45 min | à faire | L5 |
| L8 | Turnstile widget + siteverify | Vitrixxl | 1h | à faire | L4, L5 |
| L9 | CI GitHub Actions (lint + typecheck + build + tests) | Vitrixxl | 30 min | à faire | L1 |
| L10 | Tests unitaires crypto (Vitest) + test E2E story critique | Amurius | 1h | à faire | L3, L5 |
| L11 | Postmortem final + finalisation README | Vitrixxl + Amurius | 30 min | à faire | tout le reste |

**Total estimé :** ~9h cumulées, parallélisable sur 2 dev → ~5h de wall-clock.

---

## Story critique (la seule qui *doit* tourner pour la démo)

> Alice crée une identité anonyme dans son navigateur (keypair Ed25519 + X25519, mnémonique BIP-39 affichée).
> Bob fait pareil.
> Alice cherche Bob par username dans le directory.
> Alice envoie « bonjour » à Bob, chiffré en E2EE.
> Bob ouvre l'app et déchiffre « bonjour ».

Tout le reste (feed, groupes, signalements) est secondaire et peut être dégradé pour la démo si nécessaire.

---

## Hors scope MVP (assumé)

- R2 + EXIF stripping (pas d'upload image).
- DM groupe E2EE multi-parties (les groupes utilisent une clé symétrique locale du créateur).
- Notifications push (introduit un endpoint corrélable).
- Modération communautaire (UI signalement présente, modérateurs élus en M+1).
- IaC Terraform/Ansible pour le plan B.
- Monitoring Grafana / GlitchTip (logs Workers Cloudflare suffisent en MVP).
- Test de restauration backup (à faire en M+1).
- App mobile native (PWA suffit).

Voir `docs/architecture.md` §11 pour le détail.

---

## Risques identifiés

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Ed25519/X25519 non supportés sur un navigateur de jury | Faible | Bloquant pour la démo | Tester sur Chrome 133+ avant la démo. Plan B : montrer sur un mobile avec Chrome récent. |
| `wrangler deploy` échoue à 16h | Faible | Moyen | Pré-déploiement à 14h pour valider. Démo possible sur staging Pages. |
| Supabase free pause si on n'a pas pingé depuis 7 j | Très faible | Moyen | Cron Workers gratuit qui ping toutes les 24 h (à brancher demain). En démo : warm-up manuel à 14h. |
| Test E2E flaky en CI | Moyen | Faible | Si flaky, on l'isole dans un job non-bloquant et on documente. Mieux vaut un test stable que pas de test. |
| Régression visuelle après refacto crypto | Moyen | Moyen | Tester onboarding + envoi DM à la main entre 15h et 15h30. |
| Auteur unique sur l'historique git | Élevé (situation de départ) | Très négatif (brief §3.2.1) | Branches `feat/*` distinctes par lot, owner explicite, PRs croisées Vitrixxl ↔ Amurius. Voir `docs/plan.md` §commits. |

---

## Plan de commits (traçabilité multi-auteurs)

Les lots sont attribués pour qu'on ait *deux* auteurs visibles dans `git log`. Chaque commit suit Conventional Commits (cf. brief §3.2.2).

### Branche `feat/docs-artefacts` — Vitrixxl + Amurius en co-auteur

1. `docs: tensions.md auto-audit du brief` — Vitrixxl (auteur principal)
2. `docs(adr): 0001 vendor lock-in Cloudflare` — Amurius
3. `docs(adr): 0002 anonymisation vs auditabilité` — Vitrixxl
4. `docs(adr): 0003 auth Ed25519 client-side` — Amurius
5. `docs(adr): 0004 Supabase Postgres + RLS` — Vitrixxl
6. `docs: defense.md questions difficiles` — Amurius
7. `docs: architecture.md aligné MVP` — Vitrixxl
8. `docs: plan.md découpage journée` — Amurius

### Branche `feat/edge-hardening` — Amurius

9. `feat(worker): CORS strict + headers de sécurité`
10. `feat(worker): drop CF-Connecting-IP défensivement`
11. `feat(pages): _headers CSP HSTS X-Frame-Options`

### Branche `feat/auth-ed25519` — Vitrixxl

12. `feat(crypto): generate Ed25519 + X25519 keypairs via WebCrypto`
13. `feat(crypto): IndexedDB chiffrée via PBKDF2 + AES-GCM`
14. `feat(api): sign each request with Ed25519`
15. `feat(worker): verify Ed25519 signature with replay protection`
16. `feat(crypto): mnémonique BIP-39 à l'onboarding`

### Branche `feat/dm-e2ee-x25519` — Vitrixxl

17. `refactor(crypto): replace P-256 ECDH with X25519`
18. `feat(api): expose public_key_x25519 in users directory`

### Branche `feat/anti-spam` — Amurius

19. `feat(crypto): proof-of-work hashcash 18 bits client`
20. `feat(worker): verify PoW on signup and post creation`
21. `feat(worker): rate-limit by hash(pubkey + day + secret)`

### Branche `feat/turnstile` — Vitrixxl

22. `feat(client): Turnstile widget on signup and post`
23. `feat(worker): siteverify Turnstile token`

### Branche `feat/ci-tests` — Amurius

24. `chore(ci): GitHub Actions lint + typecheck + build`
25. `test(crypto): Ed25519 sign/verify + X25519 derive`
26. `test(e2e): story critique signup + DM E2EE`

### Branche `chore/finalisation` — co-auteur

27. `docs: postmortem.md retour journée`
28. `docs: README aligné MVP livré`

**Total : 28 commits prévus, ~14 par auteur, étalés sur la journée.**

---

## Prochains pas à faire (post-MVP)

| Quand | Quoi | Pourquoi |
|---|---|---|
| M+1 (semaine suivante) | IaC Terraform + Ansible pour stack EU plan B | Permettre une bascule en < 30 min si Cloudflare coupe l'EEE. Voir ADR-0001. |
| M+1 | Cron Workers ping Supabase 24h | Empêcher la pause Supabase free. |
| M+1 | UptimeRobot + alerte Telegram | Monitoring out-of-band. |
| M+1 | Test de restauration backup Supabase | Une sauvegarde non testée est de l'espoir. |
| M+2 | DM groupe E2EE multi-parties (Sender Keys ou MLS) | Rendre les groupes vraiment E2EE. |
| M+3 | Modération communautaire (élection modérateurs, journal append-only signé) | Tenir la promesse §5 ADR-0002. |
| M+5 | Audit cryptographique externe | Pré-lancement public. |
| M+6 | Lancement public | Cf. `docs/presentation/ghost-social-plan-b.md` §M6. |
