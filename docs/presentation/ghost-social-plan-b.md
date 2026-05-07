# Ghost Social — Pivot d'architecture pré-lancement « Cloudflare quitte l'EU »

> **Scénario.** On est à ~3 mois dans le développement, app pas encore lancée, ~0 utilisateur. Annonce officielle Cloudflare : **« À compter de [date], nous cesserons de servir le trafic en provenance de l'EEE. »** On a 6 mois avant la coupure et on n'a pas encore livré la v1 publique.
>
> **Bonne nouvelle.** Aucun utilisateur, aucune BDD prod, aucun média à migrer, aucune communication à orchestrer, aucun zero-downtime à garantir. Ce n'est plus un projet de migration — c'est juste **un changement de stack avant de décoller**.
>
> **Décision.** On bascule **maintenant**. On ne construit pas un seul jour de plus sur une stack qu'on sait condamnée pour notre marché cible.

---

## 1. Pourquoi pivoter immédiatement, pas attendre

Trois raisons qui rendent la décision triviale :

1. **Toute heure de dev sur Cloudflare à partir d'aujourd'hui est gaspillée.** On apprend une stack qu'on n'utilisera pas, on accumule de la dette d'abstraction qu'on devra rembourser. Mieux vaut ré-orienter dès demain.
2. **On n'a aucune contrainte de continuité.** Pas d'utilisateurs = pas de pression. Casser la stack actuelle, repartir d'une page blanche : aucun coût.
3. **La nouvelle stack devient un argument produit dès J+0 du lancement.** « Réseau social anonyme, infrastructure 100 % européenne souveraine, dès le premier jour » — c'est une promesse cohérente, pas une migration tardive justifiée a posteriori.

**Coût d'opportunité d'attendre** : on sortirait probablement la v1 sur Cloudflare en M+2, on commencerait à recruter des utilisateurs, et on devrait tout migrer en M+5 dans la pression. Tout ça pour 2 mois de « facilité » Cloudflare. Refusé.

---

## 2. Ce qui change concrètement dans la doc d'archi initiale

Le document `ghost-social-architecture.md` (la version qu'on présente au CTO/investisseur) est à mettre à jour sur ces points :

| Composant initial | Nouveau choix | Raison |
|---|---|---|
| Cloudflare Workers | **Bun sur Hetzner CX23 (Falkenstein)** | EU, 3,49 €/mois, runtime web standards |
| Cloudflare Pages | Servir la PWA depuis le même Bun + Caddy, ou **Bunny.net Edge Storage** | EU-souverain |
| Cloudflare R2 | **Scaleway Object Storage Paris** — S3-compatible, egress gratuit jusqu'à 75 GB/mois | EU, France, RGPD natif |
| Cloudflare proxy/WAF/DDoS | **Bunny.net Shield** (Slovénie) en frontal + **CrowdSec** (FR, open-source) sur le VPS | EU, anti-bot communautaire |
| Cloudflare Turnstile | **Friendly Captcha** (Munich) — sans cookie, RGPD by design | EU, plus aligné avec notre promesse |
| Cloudflare Web Analytics | **Plausible** self-hosted sur le VPS | Souverain et meilleure UX produit |
| Supabase (générique) | **Supabase Cloud — région EU Frankfurt explicite** | Vérifier `eu-central-1` à la création du projet, pas par défaut |
| GlitchTip | inchangé, déjà self-hosté | OK |

**Coût mensuel au lancement** : ~5-15 €/mois (Hetzner + Bunny + Scaleway), au lieu de 0 € sur Cloudflare.

C'est **le seul vrai changement à défendre devant le jury** : on perd la promesse littérale « 0 €/mois jusqu'à 10k MAU », elle devient « ~10 €/mois jusqu'à 10k MAU ». À arbitrer dans le pitch — on assume que la souveraineté EU vaut ce delta.

---

## 3. Le plan en 6 mois

Vu qu'on est déjà à ~3 mois de dev, on a **6 mois jusqu'à la coupure** mais pas forcément 6 mois jusqu'au lancement. On s'aligne sur le calendrier produit, en s'assurant de ne pas dépasser la deadline CF.

### M1 (J+0 → J+30) — Pivot technique propre

**Objectif** : tout le code en cours tourne sur la nouvelle stack en local et en staging. Aucun service Cloudflare n'est plus consommé en dev.

- **Semaine 1** : décision actée (cette doc), comptes ouverts (Hetzner, Scaleway, Bunny, Friendly Captcha). Domaine de staging EU réservé.
- **Semaine 1-2** : audit du code de dev existant. Lister chaque endroit qui utilise une API Cloudflare-spécifique (Workers KV, Durable Objects, R2 via binding, etc.). Pour chacun : remplacer par l'équivalent standard (`Map` en mémoire, S3 SDK pour Scaleway, etc.).
- **Semaine 2-3** : Infrastructure-as-Code dès le départ. **Terraform** pour Hetzner + Scaleway + Bunny, **Ansible** pour la config VPS. Pas de clic-clic dans des dashboards — tout en repo.
- **Semaine 3-4** : staging fonctionnel. La PWA tourne, l'API répond, Postgres connecté à Supabase EU, médias dans Scaleway, captcha Friendly intégré.
- **À la fin de M1** : on reprend la roadmap produit normale, sur la stack cible. **Cloudflare est oublié.**

**Livrable M1** : `staging.ghost-social.app` répond, déploiement reproductible via Terraform/Ansible, équipe formée à la nouvelle stack.

### M2 → M4 (J+30 → J+120) — Développement produit normal

**Objectif** : c'est *exactement* la même roadmap qu'avant l'annonce CF, juste sur une autre stack. Le pivot M1 est absorbé, on n'en parle plus.

Itérations features classiques : feed, threads, modération, signalement, PWA polish, onboarding. **Le pivot doit être invisible sur ces 3 mois** — c'est le critère de succès du M1.

Petits sujets à garder à l'œil :
- **Friendly Captcha vs Turnstile** : vérifier le taux de friction utilisateur au signup. Si Friendly est trop strict, fallback sur **hCaptcha** (gratuit jusqu'à 1M/mois).
- **Latence p95 Bun + Hetzner** : tester depuis 5 régions EU en charge réelle. Si > 200 ms p95, envisager Bunny Shield avec cache plus agressif.
- **Backups Supabase** : nightly `pg_dump | rclone scaleway:backups/`. À implémenter en M2, ne pas oublier (plus jamais d'incident sans backups out-of-band).

### M5 (J+120 → J+150) — Préparation lancement

**Objectif** : tout est prêt pour la sortie publique. Les bénéfices du pivot deviennent un **argument marketing**.

- **Audit sécurité** : code review externe, pentest léger (~500-1000 €, dans le budget pré-lancement).
- **Beta privée** : 50-200 invités via mécanisme d'invitation anonyme (génération de codes BIP-39 invitatifs).
- **Préparation des contenus de lancement** :
  - Page « Souveraineté » sur le site (datacenter, juridiction, RGPD).
  - Article de blog technique : « Pourquoi on a fait Ghost Social 100 % EU dès le premier jour » — sans dramatiser l'épisode CF, juste raconter le choix d'archi en assumant la qualité technique.
  - Pitch deck produit/investisseur mis à jour avec la nouvelle stack et son coût.
- **Monitoring out-of-band** : UptimeRobot (gratuit), alerte Telegram. Cette fois en place dès le premier user.

### M6 (J+150 → J+180) — Lancement public

**Objectif** : on lance avant que CF coupe l'EU. La coupure de CF est non-événement pour nous : on n'y est pas.

- Lancement public, ProductHunt, Hacker News (« Show HN: Ghost Social, an anonymous social network running entirely on EU infrastructure »).
- Première vague d'utilisateurs sur la stack EU dès J+0 du lancement.
- **Quand CF coupe l'EU à J+180** : *zéro impact pour nous*. On peut même en faire un post (« CF coupe l'EU aujourd'hui, et nous on s'en fiche — voici pourquoi »), accélérant le narratif souveraineté.

---

## 4. Risques et mitigations

| Risque | Probabilité | Impact | Mitigation |
|---|---|---|---|
| Le pivot M1 retarde la roadmap d'1 mois | Élevé | Moyen | C'est assumé. Mieux vaut retarder le lancement d'1 mois que migrer en panique post-lancement. |
| L'équipe découvre que Friendly Captcha / Bunny / Scaleway a une feature manquante critique | Moyen | Moyen | Évalué en M1 sur staging. Si rédhibitoire, on substitue (hCaptcha, Fastly, OVH) avant la fin du M1. |
| Coût mensuel finit > 30 €/mois au lancement | Faible | Faible | À 0 user au lancement, c'est sous le seuil de douleur. À arbitrer si > 100 €/mois à 10k MAU. |
| L'investisseur conteste la perte du « 0 €/mois » | Moyen | Faible | Préparer la réponse : « 10 €/mois pour 10k users, c'est 0,001 €/user/mois. La souveraineté EU à ce prix-là, c'est imbattable. » |
| Hetzner/Scaleway ont une panne au lancement | Faible | Élevé | SLA Hetzner et Scaleway sont solides (>99.9 %). Backups nightly out-of-band. Plan de redéploiement Ansible reproductible en 30 min sur un autre fournisseur EU si besoin. |
| Cloudflare *ne* coupe finalement *pas* l'EU (annonce annulée, recul, lobby qui marche) | Moyen | **Nul** | On a une stack souveraine EU = avantage produit conservé même si la menace s'évapore. C'est la beauté de ce pivot : il est gagnant dans tous les futurs. |

---

## 5. Ce que ça change dans le pitch d'oral

Trois choses à mettre à jour dans le script de présentation (`ghost-social-pitch.md`) :

1. **Le hook reste** : « Aucun email, aucun téléphone, aucune IP. » Inchangé.
2. **L'archi vue d'ensemble** : remplacer « Cloudflare Edge » par « Bunny.net Shield + Hetzner Falkenstein + Scaleway Paris » dans la narration. Le schéma à adapter aussi (recompiler le `.d2` et regénérer l'Excalidraw).
3. **Le coût** : passer de « 0 €/mois jusqu'à 10k MAU » à « ~10 €/mois jusqu'à 10k MAU, infrastructure 100 % EU souveraine ». **Vendre la nuance comme une feature**, pas comme une perte.

Punchline à ajouter en clôture :
> *« Notre archi tient une promesse rare : si vous nous demandez où vivent vos données, on peut pointer Falkenstein, Paris, Frankfurt sur une carte. Pas un cloud opaque US qui prétend être européen. »*

---

## 6. Ce qu'on aurait perdu en attendant

Pour rendre la décision défendable, le contre-factuel honnête :

- **Si on continue sur Cloudflare et on lance en M+2** : on signe ~500 utilisateurs early-adopters sur 4 mois, puis on doit migrer **en pression** en M+5/M+6. Risque : downtime, perte d'utilisateurs (estimation 10-15 %), narratif marketing négatif (« startup forcée de migrer dans l'urgence »), refactor plus dur (du code en prod, des données utilisateurs réelles à transférer).
- **Si on continue 3 mois puis on arrête** : on paye le prix du pivot **pendant** la pression de la sortie publique. Pire moment.
- **Si on pivote maintenant** : 1 mois de retard sur la roadmap, mais **aucune crise ensuite**. Lancement clean, narratif clean, infra clean.

Le ratio coût/bénéfice est sans appel.

---

## 7. La phrase à retenir

> *« On n'a pas migré. On n'a jamais été là. Le 16 octobre 2026, quand Cloudflare coupera l'EU, ce sera pour nous un mardi normal — parce qu'on a passé 6 mois à construire ailleurs. »*
