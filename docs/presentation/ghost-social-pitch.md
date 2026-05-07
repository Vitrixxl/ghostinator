# Ghostinator — Script d'oral (5 min)

> Version révisée le 2026-05-07 pour coller à ce qui est *vraiment livré* en prod.
> Indications scéniques en *italique*. Cibles de timing à gauche. Débit conseillé : ~150 mots/minute. Respirer entre les blocs.

---

## \[00:00\] — Le hook (30 s)

*Schéma masqué. Regarder le jury.*

Imaginez un réseau social où nous, les opérateurs, ne savons **rien** de vous. Pas votre email. Pas votre numéro. Pas votre IP. Pas votre appareil. Un réseau social où — même sous réquisition judiciaire — nous n'avons littéralement **rien à donner**, parce qu'il n'y a rien à savoir.

C'est Ghostinator. Et le défi technique qu'on a relevé, ce n'est pas de coder ce produit. C'est de le coder **avec un budget de zéro euro par mois**.

Ces deux contraintes — anonymat total et bootstrappé — sont en apparence contradictoires. Tout ce qui est gratuit dans le cloud aujourd'hui est gratuit *parce que* ça collecte de la donnée. On a dû construire à contre-courant.

---

## \[00:30\] — Les deux contraintes, vraiment (30 s)

*Toujours sans schéma. Énumérer en regardant le jury.*

**Anonymat total**, ça veut dire trois choses concrètes :

- Pas de PII collectée. Jamais.
- Pas d'IP loggée — notre code Worker ne lit même pas le header `CF-Connecting-IP`.
- Aucun identifiant côté serveur que je puisse corréler à une personne physique.

**Budget zéro**, ça veut dire :

- Aucun service qui exige une carte bancaire pour démarrer.
- Aucune dépendance qui devient payante avant 10 000 utilisateurs actifs.
- Une trajectoire de scale qui *prévoit* la croissance sans réécriture.

Ces deux contraintes ont disqualifié 80 % du marché. Firebase, AWS, Auth0 : tous écartés au premier round.

---

## \[01:00\] — L'architecture livrée (1 min 30)

*Afficher le schéma. Pointer chaque bloc en parlant.*

Voici l'architecture, telle qu'elle tourne en prod aujourd'hui sur `ghostinator.pages.dev`. Trois étages, lus de haut en bas.

**En haut, l'utilisateur** — sur une PWA, une Progressive Web App. Pas d'App Store, pas de compte Google ni Apple. L'utilisateur installe l'app via une URL. Et c'est dans son navigateur — *pas* sur notre serveur — que se passe la chose la plus importante du système : la génération de **deux paires de clés cryptographiques via WebCrypto**. Une paire **Ed25519** signe chaque requête à l'API — c'est notre auth, sans mot de passe, sans session. Une paire **X25519** dérive une clé partagée par ECDH avec le destinataire pour chiffrer les DM en bout-en-bout. Les clés privées vivent **chiffrées dans IndexedDB** par AES-GCM dérivé d'un mot de passe local via PBKDF2 210 000 itérations. Le serveur ne stocke que `sha256(pubkey Ed25519)` comme identifiant. On ne peut **techniquement pas** ré-identifier un utilisateur — pas par choix politique, par construction mathématique.

**Au milieu, Cloudflare**. C'est le cœur de notre stratégie « zéro euro ». Pages héberge la PWA — bandwidth illimité gratuit. Les Workers — V8 isolates, **moins d'une milliseconde de cold start**, soit cent fois plus rapide que Lambda — exécutent toute notre API : vérification de signature Ed25519 par requête, vérification d'un Proof-of-Work hashcash 18 bits à la création de compte, rate-limit hashé `sha256(pubkey + jour + secret rotatif)`, intégration Turnstile pour les actions sensibles. CSP stricte, CORS whitelisté, HSTS, X-Frame-Options : tout est durci dans `_headers`.

**En bas, deux briques**. Supabase Postgres en région EU Frankfurt : 500 MB gratuits, Row-Level Security pour qu'une signature ne puisse écrire que ce qui la concerne, **Realtime via WebSocket** pour pousser le feed et les DM en direct chez le destinataire. Et la frontière E2EE rouge : sur les tables `messages`, `conversations`, `group_messages`, le serveur ne stocke jamais que `{iv, cipher}` indéchiffrables sans la clé privée du destinataire — qui ne quitte jamais son navigateur.

---

## \[02:30\] — Pourquoi ces choix précis (1 min 30)

*Garder le schéma affiché.*

Trois questions pourraient vous venir. Je les anticipe.

**Pourquoi Ed25519 et pas un OAuth classique ?** Parce qu'OAuth, c'est juste **déléguer** l'identification à Google ou Apple. Le problème n'est pas résolu, il est déplacé. Avec Ed25519 généré côté client via WebCrypto natif, **personne** n'a l'identité — pas même nous. C'est le modèle de Nostr, qui tourne en production avec près d'un million de profils actifs et trente-trois millions de clés publiques. Le protocole est éprouvé. Le trade-off : perte de clé égale perte de compte. On l'assume — toute procédure de récupération serveur ouvrirait un backdoor d'identification. On a quand même livré un mécanisme d'export JSON chiffrable hors-ligne, et un **import** sur un nouvel appareil.

**Pourquoi tout sur Cloudflare alors que la contrainte d'imprévu portait sur le fournisseur principal ?** C'est précisément l'arbitrage de notre ADR-0001. Pivoter préventivement coûte un mois de dev pour neutraliser un risque qui n'est pas matérialisé. À la place, on a investi cet effort dans la **portabilité du code** : double runtime Express ↔ Worker en partage de la même API, Postgres standard chez Supabase EU, pas de Durable Objects ni Workers KV en chemin critique. Aujourd'hui, le code applicatif tourne en local sur Express avec JSON sur disque, sans toucher à Cloudflare. Si la coupure arrive, on bascule vers Hetzner Falkenstein + Scaleway Paris en cinq à sept jours, sans réécriture applicative. Le lock-in est *apparent*, pas *structurel*.

**Comment vous empêchez le harcèlement entre utilisateurs si vous ne savez pas qui ils sont ?** Quatre couches qui dissuadent sans bloquer absolument. Bloquer un hash. Signaler — un seuil communautaire masque automatiquement. Modération sur le contenu seul, sans voir l'auteur. Shadowban réversible par hash de pubkey. Plus l'économie de l'attaque : un Proof-of-Work à 18 bits coûte deux cents millisecondes par compte, cinquante par post — invisible pour un humain, prohibitif pour un bot industriel. **On ne rend pas le harcèlement impossible, on le rend économiquement non viable.** C'est un trade-off du produit, inscrit dans les CGU. On vise quatre-vingt-dix-neuf pour cent du bruit, pas cent.

---

## \[04:00\] — Si le trafic double demain (45 s)

*Pointer la zone de scale du schéma si pertinent.*

Dernière question critique : la scalabilité.

De zéro à dix mille utilisateurs actifs, on est à zéro euro. Au-delà, chaque palier est un **changement de plan**, pas une réarchitecture.

- Cinquante mille utilisateurs : Supabase Pro, vingt-cinq dollars par mois.
- Cinq cent mille : Workers Paid, cinq dollars plus trente centimes par million de requêtes.
- Cinq millions : read-replicas, partitionnement par hash de clé publique, environ deux cents dollars par mois.
- Au-delà : on vient vous voir avec ces métriques, et on lève une seed.

L'architecture supporte nativement chaque palier. Aucun point ne demande une réécriture.

**Et l'incident dont je veux parler explicitement, parce qu'on l'a vécu cet après-midi** : on a confondu la nouvelle clé publishable Supabase et la clé secret au moment du déploiement Pages. Le secret a fuité dans le bundle pendant quelques minutes. Détecté par nos logs Realtime — `CHANNEL_ERROR transport failure` — corrigé en révoquant la clé compromise et en générant une nouvelle. Le genre d'incident qui justifie la rotation de clés et le monitoring out-of-band — points reportés dans `docs/postmortem.md`. C'est aussi pour ça qu'on n'a pas voulu mentir dans cette présentation.

---

## \[04:45\] — La clôture (15 s)

*Regarder le jury, sans le schéma.*

Ghostinator, c'est un produit qui ne peut pas trahir ses utilisateurs — parce qu'il ne sait rien d'eux. C'est une stack qui ne peut pas exploser le budget — parce qu'elle est conçue pour scaler par paliers prévus. Et c'est livrable en une journée par deux dev — c'est ce qu'on vient de faire.

*Pause. Sourire.*

Vos questions ?

---

## Annexe — trois lignes à se répéter avant l'oral

1. *« Pas par choix politique, par construction mathématique. »* — pour parler de l'anonymat.
2. *« Le lock-in est apparent, pas structurel. »* — pour la dépendance Cloudflare.
3. *« Changement de plan, pas réarchitecture. »* — pour la scalabilité.

## Annexe — ce qu'on a *vraiment* livré (pour répondre honnêtement à « qu'est-ce qui marche ? »)

**Livré et fonctionnel en prod (`ghostinator.pages.dev`) :**
- Onboarding Ed25519 + X25519 + mot de passe local + IndexedDB chiffrée.
- Auto-unlock de session 1 h sliding (sessionStorage).
- Import/export d'identité pour reconnexion sur un autre appareil.
- Auth par signature Ed25519 sur chaque requête mutante avec replay protection 60 s.
- DM E2EE deux-parties via X25519 ECDH + AES-GCM 256.
- Groupes E2EE avec clé symétrique partagée, **invitation par DM chiffré** (le destinataire clique « Rejoindre », la clé est copiée chez lui).
- Filtre « mes cercles » + onglet « Découvrir » des cercles publics.
- Realtime via Supabase channels sur posts, DM, conversations, group_messages.
- Edge durci : CSP stricte, CORS whitelisté, HSTS, X-Frame-Options, drop défensif `CF-Connecting-IP` côté Worker.
- Anti-spam : Proof-of-Work 18 bits signup / 14 bits post, rate-limit hashé, Turnstile (skip si pas configuré en dev).
- CI GitHub Actions verte sur push : lint + build + 13 tests (11 unitaires crypto + 2 E2E avec PoW réel).

**Reporté explicitement (cf. `docs/postmortem.md`) :**
- Pas de R2 ni d'EXIF stripping (pas d'upload d'image dans le MVP).
- Pas de mnémonique BIP-39 (export JSON à la place).
- Pas de modération communautaire (élection modérateurs, journal append-only) — M+3.
- Pas d'IaC Terraform pour le plan B Hetzner — M+1.
- Pas de Cloudflare Web Analytics ni GlitchTip branchés — M+1.

**Honnêteté finale :** environ 80 % de l'architecture présentée il y a 3 semaines est livrée. Les 20 % restants sont reportés *pour la bonne raison* : ils ne sont pas en chemin critique de la story principale. La preuve : on a fait tourner le test E2E « créer une identité, signer une requête, envoyer un DM E2EE, le déchiffrer » avec PoW 18 bits réel — c'est ça qui devait marcher, ça marche.
