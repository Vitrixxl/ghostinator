# Document de défense — Ghostinator

> Préparation Q&A. 5 questions difficiles + réponses 3-5 lignes. Aucune question facile : si une question d'ici nous paraît facile, c'est qu'on ne se l'est pas vraiment posée.

**Auteurs :** Vitrixxl, Amurius
**Date :** 2026-05-07

---

## Question 1 : « Vous avez tous reçu il y a 15 jours un scénario d'imprévu : votre fournisseur principal devient inaccessible dans les 6 mois. Que se passe-t-il pour Ghostinator si Cloudflare quitte l'EEE ? »

*Question obligatoire (brief §4.3.3).*

Aucun utilisateur en prod aujourd'hui, donc aucune migration sous pression. Le pivot est documenté (`docs/presentation/ghost-social-plan-b.md`) et chiffré dans l'ADR-0001 : Workers → Bun sur Hetzner CX23 Falkenstein, R2 → Scaleway Object Storage Paris (S3-compatible), Turnstile → Friendly Captcha (Munich), proxy/DDoS → Bunny.net Shield + CrowdSec. 5 à 7 jours pour 2 dev, sans réécriture applicative — la preuve dans le repo : on a déjà un double backend Express ↔ Worker qui partage la même API. Coût mensuel passe de 0 € à ~10–15 €. Ce n'est pas un drame, c'est un changement de plan. Et notre identité Ed25519 client-side est totalement indépendante du fournisseur edge — aucun utilisateur ne perd son compte.

---

## Question 2 : « Sous réquisition judiciaire, que donnez-vous exactement, et est-ce que ça tient juridiquement ? »

Nous fournissons : (a) le contenu public déjà publié, (b) l'historique d'actions associées à un hash de pubkey donné. Nous ne fournissons pas : l'identité civile (inconnue par construction), l'IP (strippée à l'edge avant log), les DM (E2EE X25519, le serveur n'a que `{iv, cipher}`).

Juridiquement : France + RGPD. **Article 11 RGPD** (« traitement ne nécessitant pas l'identification ») nous protège — nous ne sommes pas tenus de collecter rétroactivement ce que l'architecture ne capte pas. **Loi Informatique et Libertés + jurisprudence CJUE La Quadrature du Net 2020** ont restreint l'obligation de conservation généralisée des données de connexion aux opérateurs de communications électroniques au sens strict (article L32 CPCE) — ce qu'un réseau social n'est pas. Donc oui, l'approche tient. Risque résiduel : régulation future spécifique aux réseaux sociaux qui imposerait l'identification — auquel cas on cesse le service dans cette juridiction. Inscrit dans les CGU. Détail complet dans ADR-0002 §« Votre approche tient-elle juridiquement ? ».

---

## Question 3 : « Comment empêchez-vous le harcèlement entre utilisateurs si vous ne savez pas qui ils sont ? »

Quatre couches, qui dissuadent sans bloquer absolument :

1. **Bloquer** : un utilisateur peut bloquer un hash de pubkey, plus de contact possible (filtrage côté client).
2. **Signaler** : seuil communautaire (5 signalements distincts) déclenche un masquage automatique en attente de revue.
3. **Modération communautaire** : modérateurs (eux-mêmes hashes de pubkey élus) voient le contenu sans voir l'auteur.
4. **Shadowban réversible** : marquage du hash. L'utilisateur poste, mais ses messages sont invisibles aux autres.
5. **Économie de l'attaque** : Proof-of-Work à la création de compte (~200 ms CPU) + à la création de post (~50 ms). Créer 100 comptes coûte 20 s CPU par appareil, multipliable mais pas industrialisable à coût zéro.

Honnêteté intellectuelle : **on ne rend pas le harcèlement impossible, on le rend économiquement non viable**. C'est un trade-off du produit, inscrit dans les CGU. Un harceleur déterminé peut toujours créer 100 comptes manuellement. On vise 99 % du bruit, pas 100 %.

---

## Question 4 : « Pourquoi vous avez choisi Cloudflare alors que vous saviez que la contrainte d'imprévu portait sur le fournisseur principal ? Vous saviez que ça arrivait, vous l'avez gardé quand même. »

C'est précisément l'arbitrage de l'ADR-0001. Pivoter préventivement coûte ~1 mois de temps de dev pour neutraliser un risque qui n'est pas matérialisé — temps qu'on a investi à la place dans la **portabilité du code** : double runtime Express ↔ Worker, Postgres standard via Supabase EU, médias derrière API S3, pas de Durable Objects ni Workers KV en chemin critique. Aujourd'hui, tout le code applicatif tourne en local sur Express avec Postgres ou JSON, sans toucher à Cloudflare. Le lock-in est *apparent*, pas *structurel*. Si la coupure arrive, on bascule en 5 à 7 jours. Si elle n'arrive pas, on a livré un MVP fonctionnel à coût zéro avec DDoS gratuit. Ratio coût/bénéfice de pivoter préventivement : négatif. Cet arbitrage est explicitement assumé.

---

## Question 5 : « Vous avez présenté il y a 3 semaines une archi avec Ed25519, Turnstile, Proof-of-Work, IndexedDB chiffrée, R2, EXIF stripping, RLS, monitoring out-of-band. Combien de tout ça est vraiment livré ? »

**Livré sur cette journée :** Ed25519 signature d'auth + X25519 ECDH pour DM E2EE, durcissement edge (CORS strict, headers de sécu, strip CF-Connecting-IP), IndexedDB chiffrée pour clé privée (PBKDF2 + AES-GCM), Proof-of-Work à signup + post, rate-limit hashé, intégration Turnstile (widget en place côté client + vérif Worker, clé prod à activer), Row-Level Security Postgres complète. Un test E2E sur la story critique + tests unitaires sur la crypto + CI GitHub Actions verte.

**Reporté explicitement :** R2 + EXIF stripping (pas d'upload image dans le MVP, donc le besoin n'est pas en chemin critique). Monitoring Grafana/GlitchTip (documenté en architecture, branchement reporté en M+1). IaC Terraform pour Hetzner+Scaleway (à écrire si bascule plan B).

**Honnêteté du delta :** ~80 % de l'architecture présentée. Les 20 % restants sont reportés *pour la bonne raison* : ils ne sont pas en chemin critique de la story principale (créer une identité anonyme, signer une requête, envoyer un DM E2EE, recevoir/déchiffrer). Détail dans `docs/postmortem.md` et arbitrage dans `docs/tensions.md` §Tension 2.

---

## Annexe : trois punchlines à se rappeler

1. *« Pas par choix politique, par construction mathématique. »* — sur l'anonymat.
2. *« Egress zéro pour toujours sur R2, et notre code ne sait même pas qu'il dépend de R2. »* — sur le lock-in.
3. *« Changement de plan, pas réarchitecture. »* — sur la scalabilité.
