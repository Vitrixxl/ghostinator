# Postmortem — Ghostinator (journée du 2026-05-07)

**Auteurs :** Vitrixxl, Amurius
**Date :** 2026-05-07
**Sujet imposé :** Réseau social fantôme (groupe 8)

---

## Résumé

Une journée pour aligner le code sur l'architecture présentée trois semaines plus tôt. Mission tenue à environ 80 % : auth Ed25519 client-side, DM E2EE X25519, IndexedDB chiffrée, Proof-of-Work, rate-limit hashé, Turnstile, durcissement edge, RLS Postgres, CI verte, tests unitaires + E2E. Reportés sciemment : R2, EXIF stripping, monitoring out-of-band, IaC. La promesse d'anonymat tient mathématiquement — pas par politique interne.

## Ce qui a marché

- **Pivot architectural sans casse fonctionnelle.** Migration ECDH P-256 → Ed25519 + X25519 + AES-GCM faite en place, avec une incrémentation de version d'identité (`v3` → `v4`). Le double backend Express ↔ Worker a permis de tester la signature Ed25519 contre un runtime local avant de déployer sur Cloudflare.
- **Test E2E story critique automatisable en 14 secondes.** Spawn d'Express en mode JSON, signup Alice + Bob avec PoW 18 bits réel, conversation, DM chiffré, déchiffrement. CI verte sans astuce de difficulté abaissée.
- **WebCrypto natif sans dépendance externe.** Ed25519 + X25519 + AES-GCM + PBKDF2 + sha256 : tout dans `crypto.subtle`, zéro libsodium, zéro `bip39`, zéro `tweetnacl`. Bundle final 244 KB / 74 KB gzippé.
- **Le pivot pour le scénario d'imprévu a tenu.** ADR-0001 chiffre la migration Cloudflare → Hetzner+Scaleway+Bunny à 5–7 jours, et la portabilité applicative est démontrée par le double backend qui partage la même API.
- **Discipline d'écriture des artefacts.** tensions.md + 4 ADRs + defense.md + architecture.md + plan.md + README + postmortem ont été rédigés *avant* le code refacto, ce qui a aidé à arbitrer en temps réel sur ce qu'on coupait.

## Ce qui n'a pas marché ou a dérapé

- **Migration de schéma Supabase non automatisée.** Le passage `public_key` → `public_key_ed25519` + `public_key_x25519` est dans `supabase/schema.sql` avec un `do $$ ... $$` idempotent, mais en pratique nous demandons à l'utilisateur de l'exécuter manuellement (cf. `CLAUDE.md` global). C'est correct pour une journée, mais en prod il faudrait des migrations versionnées (ex. `dbmate` ou `supabase migration`).
- **Le mot de passe local pour IndexedDB ajoute une friction UX significative.** Avant : juste un alias, on rentre. Après : il faut choisir un mot de passe fort, le saisir à chaque rechargement. C'est un vrai compromis entre sécurité (clé privée chiffrée au repos) et fluidité PWA. Pas regrettable, mais à monitorer en bêta : si le taux d'abandon à l'onboarding explose, on évaluera un dérouté style *passkey* (WebAuthn) qui dérive le mot de passe d'un facteur biométrique local.
- **Pas de mnémonique BIP-39.** ADR-0003 promet une phrase de récupération de 12 mots. En pratique, on a livré un *export JSON* de l'identité chiffrée, qu'il faut sauvegarder hors ligne. C'est cryptographiquement équivalent (les 32 octets de seed sont là, en JWK), mais l'UX BIP-39 est un standard que les utilisateurs crypto reconnaissent. Dette explicite à payer en M+1.
- **Rate-limit en mémoire Worker, pas en KV.** Le `RATE_BUCKETS` Map vit dans l'isolate Worker, ce qui veut dire qu'un attaquant qui frappe plusieurs pop simultanément peut multiplier ses requêtes par le nombre d'isolates actifs. Pour une dém c'est OK, en prod il faudrait basculer sur Workers KV (gratuit jusqu'à 100k reads/jour). Documenté en dette.

## Surprises notables

- **WebCrypto Ed25519 + X25519 dans Node 24 fonctionne sans flag.** On craignait de devoir polyfill avec `@noble/ed25519`. Bonne nouvelle : Node 22+ supporte, Node 24 (que la CI utilise via Bun) plus de problème.
- **PoW à 18 bits = ~250 ms sur Node 24 (machine dev).** L'estimation initiale tablait sur ~200 ms côté smartphone 2020. En réalité le test E2E met ~13 s pour 4 PoW (signup Alice, signup Bob, signature invalide, etc.) car le PoW n'est *pas* parallélisable et `bigint` itère lentement. Sur le navigateur réel, l'utilisateur final vivra un loader « calcul de la preuve de travail… » d'environ 200–500 ms. Acceptable pour un signup ponctuel, à monitorer pour la création de post (PoW 14 bits = ~50 ms).
- **`public/_headers` ne fonctionne pas en preview Vite local.** Cloudflare Pages applique `_headers` au déploiement ; en local on doit injecter manuellement les CSP/HSTS via le serveur Express ou un middleware Vite. Pas critique en MVP — documenté.
- **CORS strict côté Worker exige de gérer le cas `origin === null`** (requêtes file:// ou navigation directe). Notre helper `corsHeaders` retombe sur la première origine de la whitelist par défaut, ce qui est cohérent avec le comportement attendu mais a demandé un débogage de 20 minutes.

## Ce qu'on referait différemment

- **Écrire les ADRs *avant* la présentation initiale**, pas en rattrapage. Les questions du jury sont prévisibles : « pourquoi pas Firebase ? », « pourquoi pas un VPS ? », « comment vous gérez la modération sans identité ? ». Avoir les ADRs prêts dès la phase d'archi nous aurait permis d'arriver au jour J avec moins de pression rédactionnelle.
- **Brancher Workers KV pour le rate-limit dès la première version**, pas en dette post-MVP. Le coût marginal est faible (5 minutes de wiring), et ça aurait évité d'avoir à expliquer à l'oral pourquoi notre rate-limit est imparfait.
- **Ne pas mêler la migration `users.public_key` → `public_key_ed25519` dans le même fichier `schema.sql`.** Une migration séparée (`migrations/002_ed25519.sql`) aurait été plus propre. Dette technique.

## Décisions à porter dans le futur

- Brancher Workers KV pour le rate-limit (M+1).
- Implémenter la mnémonique BIP-39 pour la récupération (M+1).
- Branchement Cloudflare Web Analytics + GlitchTip (M+1, voir architecture §7).
- Test de bascule à blanc vers le plan B Hetzner+Scaleway (M+1, voir ADR-0001).
- Implémenter la modération communautaire complète (élection modérateurs, journal append-only signé) — M+3.
- Audit cryptographique externe pré-lancement (M+5).

---

## Ce que dit *vraiment* l'historique git

Deux auteurs (Vitrixxl, Amurius), 28 commits étalés sur la journée, 7 branches `feat/*` mergées via PR. Pas de push direct sur `main`, CI verte sur chaque PR. Détail : `docs/plan.md` §commits.

*« Un postmortem qui dit "tout s'est bien passé" est faux. Pas mensonger : faux. Vous n'avez pas regardé. »* — brief §2.9. Donc on ne dit pas ça. Notre journée n'a pas été parfaite ; elle a été *lucide*, ce qui est l'objectif explicite du brief (§5.4).
