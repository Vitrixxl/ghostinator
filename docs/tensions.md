# Tensions et arbitrages identifiés dans le brief

> Auto-audit (brief §2.9.1). Document court, pas exhaustif. Quatre tensions concrètes que nous avons croisées en lisant le brief, et nos arbitrages assumés.

**Auteurs :** Artus, Vitrice
**Date :** 2026-05-07
**Sujet imposé :** Réseau social fantôme (groupe 8)
**Contraintes imposées :** Anonymisation totale, équipe sans admin sys

---

## Tension 1 : « Anonymisation totale » et auditabilité légale

- **Citation du brief :** « *Pour le groupe 8 (réseau social fantôme) : votre contrainte est l'anonymisation totale des informations utilisateurs. Vous devez aussi pouvoir auditer toutes les actions pour répondre à une éventuelle réquisition légale (publication illégale, harcèlement, fraude).* » (§3.4.4)
- **Pourquoi c'est une tension :** ces deux exigences sont en contradiction frontale. Une anonymisation parfaite (pas de PII, pas d'IP, pas d'identifiant ré-identifiable) rend toute auditabilité légale impossible par construction. Une auditabilité réelle exige *au minimum* un identifiant stable et une corrélation avec une personne physique — ce qui contredit l'anonymisation. Ce sont deux régimes incompatibles, et les concilier complètement est mathématiquement faux.
- **Notre arbitrage :** nous traitons les deux exigences comme deux *régimes* distincts plutôt qu'un seul. Régime « par défaut » : anonymat total par construction cryptographique (Ed25519 généré côté client, hash de pubkey côté serveur, IP strippée à l'edge). Régime « réquisition » : nous ne pouvons fournir *que* du contenu public déjà publié et l'historique d'actions par hash de pubkey — rien qui ré-identifie un humain. Nous documentons explicitement que cette limite est *by design* dans l'ADR-0002, et nous l'inscrivons dans les CGU. Le harcèlement intra-plateforme est traité sans identité (proof-of-work anti-spam, signalements communautaires, shadowban réversible par hash de pubkey). Voir ADR-0002 pour le détail.

---

## Tension 2 : « Production-ready » et MVP livrable en une journée

- **Citation du brief :** « *Vous devez livrer du code production-ready : structuré, testable, lisible, observabilité minimale. Mais vous devez aussi livrer un MVP rapidement, en quelques heures de codage effectif sur la journée.* » (§2.6.2)
- **Pourquoi c'est une tension :** l'architecture présentée la semaine dernière (Ed25519 + X25519 E2EE, Turnstile, Proof-of-Work, IndexedDB chiffrée, R2 + EXIF stripping, RLS, observabilité, IaC, monitoring out-of-band) représente plusieurs semaines de travail propre. Tout livrer en une journée à deux dev produit nécessairement du code à moitié fini, ce qui contredit « production-ready ».
- **Notre arbitrage :** nous priorisons la **story critique de bout en bout** (créer une identité Ed25519, signer une requête, envoyer un DM E2EE, recevoir/déchiffrer) plutôt que de saupoudrer toutes les couches. Lots livrés sur cette journée : auth Ed25519, durcissement edge (CORS strict + strip IP + headers de sécu), DM E2EE X25519, IndexedDB chiffrée, PoW client, rate-limit hashé. Lots reportés explicitement : Turnstile (intégré mais clé de prod à demander), R2 + EXIF stripping (pas d'upload image dans le scope MVP), monitoring Grafana/GlitchTip (documenté en architecture mais pas branché). Le hors-scope est documenté dans le README et dans `plan.md`.

---

## Tension 3 : « Équipe sans admin sys » et exigence de CI/CD + observabilité

- **Citation du brief :** contrainte imposée groupe 8 — « *Équipe sans admin sys* » (§1.5). Et plus loin : « *Pipeline minimum exigé pour cette journée, à chaque push : 1. Lint, 2. Test (lancer au moins le test E2E sur le chemin critique). […] 3. Build, 4. Déploiement automatique en staging, 5. Déploiement manuel en prod.* » (§2.7.1) plus l'observabilité §2.8.2.
- **Pourquoi c'est une tension :** « pas d'admin sys » signifie pas de cluster K8s à maintenir, pas de Postgres self-hosted, pas de Prometheus à opérer. Mais le brief exige aussi un pipeline CI/CD complet, une observabilité structurée, et un déploiement reproductible. Les deux ne sont pas absolument contradictoires, mais ils orientent la stack : tout doit être managé/serverless avec un pipeline qui ne demande aucune intervention système.
- **Notre arbitrage :** stack **100 % managée** (Cloudflare Pages + Workers + Supabase + GitHub Actions free) qui élimine le besoin d'admin sys. CI = GitHub Actions free tier (lint + test E2E + build, < 5 min). CD = `wrangler deploy` côté Worker, Cloudflare Pages auto-deploy sur push `main`. Observabilité = Cloudflare Web Analytics + logs JSON Worker via `console.log` capturés par Cloudflare Logs. Cette contrainte explique pourquoi nous avons rejeté un VPS Hetzner en plan A — il devient seulement le plan B (ADR-0001), et son activation transformerait notre constrainte « sans admin sys » en signal d'alerte à arbitrer à nouveau.

---

## Tension 4 : « Budget zéro » et souveraineté EU sous contrainte d'imprévu

- **Citation du brief :** « *Budget de démarrage quasi nul* » (contrainte §1.5) et le scénario d'imprévu déjà annoncé : « *votre fournisseur principal devient inaccessible dans les 6 mois* » (§4.3.3). Plus le rappel : « *Pour les groupes avec contrainte de latence ultra-faible mondiale (groupe 5)…* » (§2.8.4) — *a contrario*, notre groupe ne l'a pas, mais la souveraineté EU reste implicite dès qu'on parle d'anonymat et de RGPD.
- **Pourquoi c'est une tension :** Cloudflare est le seul edge gratuit qui offre simultanément (a) le strip IP côté edge, (b) Pages + Workers + R2 + Turnstile, (c) DDoS protection illimitée. Le scénario d'imprévu nous demande d'imaginer Cloudflare inaccessible sous 6 mois — auquel cas nous perdons tous ces leviers d'un coup. Aucune alternative gratuite EU n'offre l'équivalent fonctionnel.
- **Notre arbitrage :** nous restons sur Cloudflare en plan A (zéro coût jusqu'à 10k MAU) **mais** nous écrivons le code en supposant que chaque dépendance Cloudflare-spécifique peut tomber. Concrètement : Postgres standard chez Supabase (portable vers tout Postgres managé EU), R2 derrière l'API S3 (portable vers Scaleway Object Storage Paris), Workers en JavaScript portable (portable vers Bun + Hetzner Falkenstein), pas de Durable Objects ni Workers KV en chemin critique. L'ADR-0001 chiffre cette migration à 5–7 jours pour deux dev, sans réécriture applicative. La contrainte « budget zéro » devient « budget ~10 €/mois » dans le plan B, ce que nous assumons.

---

## Tension 5 : Anonymat strict et UX temps réel

- **Citation du brief :** « *Notre architecture présentée la semaine dernière était censée intégrer cette contrainte.* » (§4.3.3) — appliqué ici au principe « *jamais de métadonnée corrélable côté serveur* ». Et le brief §1.5 : « *anonymisation totale* ».
- **Pourquoi c'est une tension :** pour pousser des messages en temps réel via WebSocket sans interroger périodiquement le serveur, les clients doivent s'abonner directement à Supabase Realtime. Cela exige une policy `SELECT` publique sur les tables `messages` et `conversations` — ce qui révèle de la métadonnée (`author_hash`, `conversation_id`, `created_at`, taille du `cipher`). Le contenu reste E2EE (X25519+AES-GCM, illisible sans la clé privée), mais la métadonnée fuit. Le pur respect de la contrainte « anonymisation totale » impliquerait soit pas de temps réel, soit du polling court, soit un proxy WebSocket via Worker (nécessite Durable Objects, payants — contradiction avec ADR-0001).
- **Notre arbitrage :** nous activons Realtime sur `messages`, `conversations`, `posts` avec `SELECT` publique. Justification : (a) le contenu reste chiffré E2EE, (b) `/api/bootstrap` du Worker accepte déjà n'importe quel hash sans signature, donc la métadonnée est *déjà* exposée — Realtime ne dégrade pas la posture, (c) l'expérience utilisateur d'un réseau social sans temps réel est inacceptable, (d) le client Supabase utilisé est `anon` (jamais le `service_role`), donc pas d'écriture possible. Dette : remplacer en M+1 par un endpoint signé Ed25519 + Realtime Authorization Policies basées sur JWT (Supabase 2024+) pour scoper l'abonnement aux conversations dont la signature prouve l'appartenance. Documenté dans `docs/plan.md` §M+1.

## Note opérationnelle : session locale courte

Au-delà des tensions du brief, une décision UX assumée : la PWA garde le mot de passe local en `sessionStorage` pendant 1 h après chaque saisie (sliding window). Permet un rechargement de page sans re-saisie. `sessionStorage` est par-onglet (pas de fuite cross-tab), même surface d'attaque que la clé privée déjà en mémoire JS. Forfait acceptable pour un MVP. Effacé sur logout explicite et automatiquement à la fermeture du navigateur.

## Ce que nous n'avons pas traité comme tension

- « Latence ultra-faible mondiale » — n'est pas dans nos contraintes (groupe 8), donc pas un sujet pour nous.
- « 99,999 % d'uptime » — n'est pas dans nos contraintes. Un réseau social fantôme dégradé pendant quelques heures n'est pas un incident grave (pas de chaîne hospitalière, pas de transaction financière).
- « Conformité HDS / DSP2 » — n'est pas dans nos contraintes (ce sont les groupes télémédecine et fintech). Notre socle reste RGPD + ePrivacy.
