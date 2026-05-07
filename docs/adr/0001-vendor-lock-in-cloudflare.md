# ADR 0001 : Trade-off vendor lock-in Cloudflare vs vitesse de delivery

**Statut :** Accepté
**Date :** 2026-05-07
**Auteurs :** Artus, Vitrice
**ADR obligatoire (brief §2.3.2) :** oui — réponse à la contrainte d'imprévu annoncée 15 jours avant la session

---

## Contexte

Le brief impose une contrainte d'imprévu : **le fournisseur principal devient inaccessible dans les 6 mois** (§4.3.3). Notre architecture présentée s'appuie fortement sur Cloudflare (Pages, Workers, R2, Turnstile, Web Analytics, proxy avec strip IP). Le scénario que nous instancions ici : *Cloudflare annonce qu'il cesse de servir le trafic en provenance de l'EEE à compter de J+180*.

Nous avons aussi la contrainte du sujet : **anonymisation totale + équipe sans admin sys + budget de démarrage quasi nul** (§1.5). Ces contraintes orientent fortement le choix initial vers Cloudflare, qui est aujourd'hui la seule plateforme gratuite EU offrant simultanément :

- strip de l'IP client à l'edge (Managed Transform « Remove visitor IP headers ») ;
- DDoS protection illimitée gratuite ;
- Pages bandwidth illimité + Workers + R2 egress 0 € + Turnstile sans cookie, le tout gratuit jusqu'à des seuils confortables.

La question est : combien d'effort consacrons-nous à neutraliser ce lock-in *avant* la coupure, sachant que nous n'avons pas encore de production live ?

---

## Options envisagées

### Option A — Pivoter immédiatement vers une stack 100 % EU souveraine

Bun sur Hetzner CX23 Falkenstein (3,49 €/mois), Caddy en frontal, Scaleway Object Storage Paris (S3-compatible, egress 75 GB gratuits/mois) à la place de R2, Friendly Captcha (Munich) à la place de Turnstile, Plausible self-hosted à la place de Web Analytics, Bunny.net Shield (Slovénie) en frontal pour le DDoS et le cache.

- **Avantages :** souveraineté EU dès J+0 du lancement, narratif marketing cohérent (« anonymat *et* infrastructure 100 % européenne »), aucun risque de coupure CF à digérer en pleine croissance utilisateur.
- **Inconvénients :** introduit la contrainte « équipe sans admin sys » (un VPS, ça s'administre — TLS, OS patches, pare-feu, monitoring out-of-band). Coût mensuel passe de 0 € à ~10–15 €. Effort de pivot estimé à 1 mois sur 6 (soit ~17 % du temps disponible).

### Option B — Rester sur Cloudflare avec stack volontairement portable, plan B documenté et testé

On exploite Cloudflare gratuit jusqu'au MVP et au-delà, mais chaque brique est choisie pour être interchangeable :

- Postgres standard via Supabase EU Frankfurt (portable vers Neon, OVHcloud Managed Postgres, ou tout Postgres managé EU).
- Médias derrière l'API S3 (R2 aujourd'hui, Scaleway Object Storage Paris demain — bascule = changer l'endpoint).
- Workers en JavaScript portable, sans Durable Objects ni Workers KV en chemin critique. Le code Worker doit pouvoir tourner derrière `bun run` ou Node sur un VPS sans réécriture applicative — c'est exactement la posture qu'on a déjà côté `worker/src/index.js` vs `server/index.js`.
- Turnstile et Web Analytics : remplaçables par Friendly Captcha + Plausible. Pas en chemin critique applicatif.
- Identité : Ed25519 + X25519 via WebCrypto, totalement indépendant de tout fournisseur.

- **Avantages :** zéro coût, vitesse de delivery préservée, contrainte « équipe sans admin sys » respectée (rien à administrer côté serveur), DDoS gratuit immédiat, narratif initial « 0 €/mois jusqu'à 10k MAU » conservé.
- **Inconvénients :** lock-in apparent si on lit l'architecture sans creuser. Si Cloudflare coupe l'EEE *après* mise en prod avec utilisateurs réels, on a une migration à orchestrer sous pression (~5–7 jours pour 2 dev), avec un risque de coupure de service.

### Option C — Multi-cloud actif dès le départ (Cloudflare + Hetzner en parallèle)

Déployer simultanément sur Cloudflare et un VPS EU avec basculement DNS automatique.

- **Avantages :** résilience maximale, bascule en minutes.
- **Inconvénients :** double coût opérationnel, double complexité de déploiement, contradiction frontale avec la contrainte « équipe sans admin sys » et avec « budget quasi nul ». Pour 2 dev sur une journée, c'est l'option qui empêche la livraison.

---

## Décision

**Option B** : on reste sur Cloudflare en plan A, avec une stack volontairement portable et un plan B chiffré et documenté.

L'arbitrage repose sur :

- Aujourd'hui, **0 utilisateur en prod, donc pas de coût de migration humain** (ce que confirme la note §1 de notre `docs/presentation/ghost-social-plan-b.md`).
- L'architecture *est* portable par construction. Le double backend Express ↔ Worker que nous avons aujourd'hui est la preuve que le code applicatif n'est pas verrouillé sur Cloudflare — la même API tourne derrière les deux runtimes.
- La contrainte d'imprévu est traitée par un **plan B exécutable** (voir §plan-b ci-dessous), pas par un évitement préventif.

---

## Plan B : si Cloudflare devient inaccessible

Détaillé exhaustivement dans `docs/presentation/ghost-social-plan-b.md`. Synthèse :

| Composant Cloudflare | Remplaçant EU souverain | Délai migration |
|---|---|---|
| Workers | Bun sur Hetzner CX23 Falkenstein | 2 j (le code Worker tourne déjà comme un Express, voir `server/index.js`) |
| Pages | Caddy sur le même VPS (Caddy fait HTTPS automatique via Let's Encrypt) | 0,5 j |
| R2 | Scaleway Object Storage Paris (S3-compatible) | 0,5 j (changer l'endpoint) |
| Turnstile | Friendly Captcha (Munich) — sans cookie, RGPD by design | 0,5 j |
| Web Analytics | Plausible self-hosted | 0,5 j |
| Proxy/WAF/DDoS | Bunny.net Shield (Slovénie) en frontal + CrowdSec sur le VPS | 1 j |
| Stripping IP | Caddy `header_remove X-Forwarded-For X-Real-IP` + log avec `remote_ip masked` | 0,5 j |

**Total estimé :** 5–7 jours pour 2 dev, hors fenêtre d'apprentissage Bunny/CrowdSec si nouveau pour l'équipe.

**Coût mensuel post-migration :** ~10–15 €/mois (Hetzner CX23 + Bunny + Scaleway hors palier gratuit).

**Déclencheur d'activation du plan B :** annonce officielle Cloudflare avec date de coupure, OU dégradation tarifaire qui sortirait du free tier sans préavis raisonnable, OU incident de souveraineté (ex. requête extra-territoriale US sur Cloudflare EU).

**Préparation d'astreinte :** un script Terraform + Ansible (à écrire en M+1 du lancement, hors scope MVP de cette journée) doit pouvoir provisionner la stack EU en moins de 30 minutes. Aujourd'hui le déploiement est manuel — c'est une dette explicite que nous portons (voir `docs/plan.md`).

---

## Conséquences

- **Positives :**
  - 0 €/mois jusqu'à 10k MAU, conforme à la contrainte budget de démarrage quasi nul.
  - Contrainte « équipe sans admin sys » respectée — rien à administrer.
  - DDoS et bandwidth gratuits dès le premier utilisateur.
  - Architecture portable par construction (preuve dans le repo : double backend Express/Worker partageant la même API).

- **Négatives :**
  - Lock-in apparent à un acteur unique. Cet ADR existe précisément pour rendre ce lock-in explicite et chiffrer son coût de sortie.
  - Le plan B n'est pas testé en environnement réel à ce stade (pas de bascule à blanc effectuée). C'est une dette assumée : nous prévoyons un test de bascule à blanc en M+1 du lancement.

- **Risques :**
  - Cloudflare durcit ses conditions tarifaires sans préavis raisonnable. Mitigation : free tier monitorisé manuellement, plan B exécutable en moins d'une semaine.
  - Cloudflare devient hostile (juridiction US, requêtes extra-territoriales contre un service EU). Mitigation : aucune PII collectée donc rien à transmettre, mais le narratif souveraineté serait abîmé. Bascule plan B activée.
  - L'équipe oublie cette portabilité au fil des features et introduit une dépendance forte (ex. Durable Objects ou Workers KV en chemin critique). Mitigation : revue de PR systématique sur l'introduction de toute API Cloudflare-spécifique, mention dans `CLAUDE.md` et dans le README.

- **Réversibilité :**
  Migration vers stack EU souveraine estimée à 5–7 jours pour 2 dev, sans réécriture applicative. Coût d'opportunité : ~1 semaine de roadmap produit. Pas de coût utilisateur (pas de session à invalider, pas de mot de passe à re-saisir — l'identité est cryptographique côté client, donc préservée).

---

## Lien avec la contrainte d'imprévu (brief §4.3.3)

Cet ADR est notre réponse explicite au scénario d'imprévu : **fournisseur principal inaccessible dans les 6 mois**. La défense orale (`docs/defense.md`) contient une question dédiée et une réponse chronométrée. L'architecture livrée reflète ces choix : aucune dépendance Cloudflare en chemin critique applicatif, double runtime déjà fonctionnel, plan B chiffré.
