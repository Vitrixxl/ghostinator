# Glossaire — Ghost Social Architecture

Explication de tous les termes techniques présents dans `ghost-social-architecture.pdf`.

---

## 1. Concepts généraux

### PWA (Progressive Web App)
Application web qui se comporte comme une app native : installable sur le téléphone/bureau, fonctionne hors ligne, envoie des notifications push. Pas besoin de passer par l'App Store ou le Play Store.

### MAU (Monthly Active Users)
Utilisateurs actifs mensuels. Métrique standard pour mesurer la taille réelle d'un service (≠ inscrits).

### MVP (Minimum Viable Product)
Version minimale d'un produit contenant juste assez de fonctionnalités pour être utilisable et testée auprès de vrais utilisateurs.

### PII (Personally Identifiable Information)
Données personnelles permettant d'identifier une personne (email, IP, téléphone, nom, etc.). Objet principal du RGPD.

### RGPD / ePrivacy / CCPA
- **RGPD** : règlement européen sur la protection des données personnelles (2018).
- **ePrivacy** : directive européenne sur la vie privée dans les communications électroniques (cookies, tracking).
- **CCPA** : équivalent californien du RGPD (California Consumer Privacy Act).

### Subpoena
Réquisition judiciaire : ordre légal de fournir des données. Dans le doc, on assume qu'on ne peut rien fournir puisqu'on ne collecte rien.

### TOS (Terms of Service)
Conditions générales d'utilisation d'un service.

---

## 2. Cryptographie & authentification

### Ed25519
Algorithme de signature numérique basé sur les courbes elliptiques (courbe Edwards 25519). Rapide, sûr, clés courtes (32 octets). Utilisé par SSH, Signal, Nostr, etc.

### Keypair (paire de clés)
Paire clé publique / clé privée.
- **Clé privée** : reste chez l'utilisateur, sert à signer.
- **Clé publique (pubkey)** : partagée, sert à vérifier les signatures.

### hash(pubkey)
Empreinte cryptographique de la clé publique (ex: SHA-256). Le serveur stocke cela au lieu de la pubkey elle-même pour éviter toute corrélation.

### Signature cryptographique
Preuve mathématique qu'un message a été produit par le détenteur d'une clé privée, sans révéler cette clé.

### BIP-39
Standard de l'industrie crypto (Bitcoin Improvement Proposal 39) : convertit une clé privée en 12 ou 24 mots mémorables ("phrase mnémonique"). 12 mots = 128 bits d'entropie = impossible à deviner par brute force.

### Nostr
Protocole décentralisé de réseau social basé sur Ed25519. Chaque utilisateur est une clé publique, chaque message est signé. Référence citée dans le doc car prouvé à l'échelle (33M de pubkeys en 2024).

### OTP (One-Time Password)
Code à usage unique (souvent par SMS ou app d'authentification).

### OAuth
Protocole d'authentification déléguée ("Se connecter avec Google/Apple/GitHub"). Rejeté ici car transfère l'identité au fournisseur tiers.

### E2EE (End-to-End Encryption)
Chiffrement bout-en-bout : seuls l'émetteur et le destinataire peuvent lire, pas même le serveur. Nécessaire pour les DM privés mais complexe à implémenter correctement.

---

## 3. Edge / Cloudflare

### Edge (edge computing)
Exécution du code au plus près du client (sur des serveurs répartis dans le monde) au lieu d'un datacenter central. Latence basse.

### Cloudflare Proxy
Cloudflare se place entre le client et le serveur d'origine ("origin") : il reçoit les requêtes, peut les filtrer/modifier, puis les transmet.

### Origin
Serveur d'origine réel derrière le proxy Cloudflare.

### Cloudflare Workers
Fonctions serverless qui tournent sur le réseau edge de Cloudflare. Écrites en JS/TS/Rust/WASM.

### V8 isolates
Mécanisme d'isolation léger du moteur JS V8 (celui de Chrome/Node). Démarrage quasi instantané (<1 ms), bien plus rapide qu'un container Lambda (centaines de ms).

### Cold start
Latence au premier démarrage d'une fonction serverless inactive. Workers en ont quasi pas grâce aux V8 isolates.

### Cloudflare Pages
Hébergement de sites statiques et frontend (React, Vue, etc.) gratuit et illimité en bandwidth.

### Cloudflare R2
Stockage d'objets compatible S3 (pour images, vidéos, fichiers). Particularité : **egress gratuit** (vs S3 qui facture la sortie).

### Turnstile
CAPTCHA alternatif de Cloudflare. Anonyme, sans cookie, souvent invisible pour l'utilisateur. Alternative à reCAPTCHA (Google).

### WAF (Web Application Firewall)
Pare-feu applicatif : filtre les requêtes malveillantes (injection SQL, XSS, etc.) avant qu'elles atteignent l'origin.

### Bot Management
Détection et blocage automatique des bots malveillants.

### DDoS (Distributed Denial of Service)
Attaque par saturation : des milliers de machines envoient des requêtes pour rendre un service indisponible. Cloudflare protège gratuitement.

### Headers HTTP
- **CF-Connecting-IP** : header ajouté par Cloudflare indiquant l'IP réelle du client.
- **True-Client-IP** / **X-Forwarded-For** : équivalents standards.
- **Managed Transform "Remove visitor IP headers"** : option Cloudflare qui strippe ces headers avant de forwarder à l'origin → le backend ne voit jamais d'IP client.

### Bandwidth Alliance
Partenariat entre Cloudflare et plusieurs fournisseurs cloud (Backblaze, DigitalOcean, etc.) pour rendre le transfert de données entre eux gratuit.

### Egress
Trafic sortant du cloud vers Internet. Généralement facturé cher (le "piège" d'AWS). R2 et le Bandwidth Alliance le rendent gratuit.

---

## 4. Base de données

### Supabase
Alternative open-source à Firebase. Propose Postgres managé + Auth + Realtime + Storage + Edge Functions.

### Postgres (PostgreSQL)
Base de données relationnelle open-source, très mature, supporte SQL complet, JSON, full-text search.

### NoSQL
Bases non-relationnelles (MongoDB, DynamoDB…). Bien pour les documents simples, moins pour les graphes relationnels.

### JOIN
Opération SQL pour combiner des tables. Fondamentale pour un réseau social (users × posts × follows × likes).

### Index composite
Index portant sur plusieurs colonnes simultanément, pour accélérer les requêtes combinées.

### RLS (Row-Level Security)
Sécurité au niveau de la ligne dans Postgres : chaque ligne a une politique d'accès. Permet de filtrer les données directement dans la BDD, sans logique applicative.

### Realtime (WebSocket / WS)
Connexion persistante entre client et serveur pour pousser les updates en direct (nouveau post, like, etc.).

### pgBouncer / Supavisor
Poolers de connexions Postgres : multiplexent les connexions clients sur un petit nombre de connexions BDD. Nécessaire en production (Postgres tient mal des milliers de connexions ouvertes).

### TOAST (The Oversized-Attribute Storage Technique)
Mécanisme interne de Postgres qui compresse et stocke à part les grandes colonnes (long texte par exemple).

### Parquet
Format de fichier colonnaire optimisé pour l'analytique (utilisé par Spark, DuckDB, Snowflake). Très compressé.

### DuckDB
BDD analytique embarquée (équivalent SQLite pour l'analytique). Peut lire Parquet directement.

### Citus
Extension Postgres qui permet le sharding horizontal (distribue les données sur plusieurs nœuds).

### CockroachDB
BDD distribuée compatible Postgres, conçue pour le scale horizontal global.

### Sharding
Découpage d'une base en plusieurs morceaux (shards) répartis sur plusieurs serveurs.

### Read-replicas
Copies en lecture seule de la BDD pour répartir la charge de lecture.

### Partitionnement
Découpage interne d'une table en sous-tables selon un critère (ex: par `author_pubkey_hash`) pour améliorer les perfs.

---

## 5. Sécurité & anti-abus

### Proof-of-Work (PoW)
Puzzle cryptographique imposant un calcul coûteux au client (ex: trouver un hash avec N zéros). Invisible pour un humain (~200 ms), ruineux pour un bot qui multiplie les comptes. Inspiré d'Hashcash / Bitcoin.

### Hashcash
Système historique de PoW pour lutter contre le spam email.

### Rate-limit
Limitation du nombre de requêtes par unité de temps. Ici fait sur `hash(pubkey + jour + secret_rotatif)` pour compter sans identifier.

### Secret rotatif
Clé secrète côté serveur qui change régulièrement (ex: chaque jour). Empêche la corrélation long terme des hashes.

### Shadowban
Bannissement invisible : l'utilisateur continue de poster, mais plus personne ne voit ses messages. Il ne sait pas qu'il est banni.

### EXIF
Métadonnées attachées aux photos (GPS, modèle d'appareil, date). Considérées comme PII sous RGPD. Doivent être strippées avant upload public.

### Stripping
Suppression de certaines données (ici : métadonnées EXIF, headers IP).

### Backdoor
Porte dérobée : toute mécanique permettant de contourner la sécurité. Ici, une "récupération de compte" serveur serait un backdoor d'identification.

### Fingerprinting
Identification d'un utilisateur via les caractéristiques uniques de son navigateur (polices, canvas, WebGL, etc.), même sans cookie.

---

## 6. Observabilité (logs, métriques, analytics)

### Observabilité
Capacité à comprendre l'état interne d'un système depuis ses sorties (logs, métriques, traces).

### Sentry
Service de tracking d'erreurs populaire. Rejeté ici car il logue des PII (IP, user agent, stack traces contenant parfois des données privées).

### GlitchTip
Fork open-source de Sentry, compatible avec ses SDK. Self-hostable sur un petit VPS.

### Grafana Cloud
Plateforme de monitoring / dashboards. Plan gratuit suffisant pour une petite app.

### Séries de métriques
Une métrique (ex: `requests_per_second`) avec un set de labels (ex: `route=/login`, `status=200`) compte comme une série distincte.

### Cloudflare Web Analytics
Analytics sans cookie, sans localStorage, sans fingerprinting. Alternative à Google Analytics.

### localStorage / IndexedDB
Stockages côté navigateur.
- **localStorage** : simple clé/valeur, ~5-10 MB.
- **IndexedDB** : BDD structurée côté client, plusieurs centaines de MB. Utilisée ici pour stocker la clé privée chiffrée.

---

## 7. Infra / hébergement / plan B

### VPS (Virtual Private Server)
Serveur virtuel dédié chez un hébergeur (Hetzner, OVH, DigitalOcean…).

### Hetzner CX23
Modèle de VPS d'Hetzner (hébergeur allemand réputé pour son rapport qualité/prix). ~3,49 €/mois.

### Backblaze B2
Stockage objet S3-compatible, moins cher qu'AWS S3. Egress gratuit vers Cloudflare via Bandwidth Alliance.

### S3-compatible
Respecte l'API S3 d'AWS → on peut migrer d'un provider à l'autre sans réécrire le code.

### Caddy
Serveur web moderne (alternative à Nginx/Apache). HTTPS automatique via Let's Encrypt.

### Node / Bun
Runtimes JavaScript côté serveur.
- **Node** : historique, standard.
- **Bun** : plus récent, plus rapide, compatible Node.

### Vendor lock-in / lock-out
Dépendance forte à un fournisseur (difficile d'en changer). Mitigé ici par la portabilité (Postgres, S3-compatible, Workers exportables).

### Porkbun
Registrar de noms de domaine bon marché.

### `.pages.dev`
Sous-domaine gratuit fourni par Cloudflare Pages (ex: `monapp.pages.dev`).

---

## 8. Social features / UX

### Feed
Fil d'actualité (chronologique ou algorithmique).

### Thread / Reply
Fil de discussion, réponse à un post.

### Reaction
Like, emoji, etc.

### Social graph
Graphe des relations (qui suit qui, qui interagit avec qui).

### Recommandations ML
Algorithme de machine learning qui suggère du contenu personnalisé. Coûteux en compute → hors scope.

### DM (Direct Message)
Message privé entre utilisateurs. Nécessite E2EE pour être vraiment privé.

### Offline-first
Conception où l'app fonctionne sans connexion : les données sont d'abord stockées localement puis synchronisées.

### Onboarding
Parcours de première connexion / inscription.

### QR code (pour sync)
Mécanisme pour transférer la clé privée entre devices de manière sécurisée (scan via webcam).

---

## 9. Économique / scale

### Serverless
Modèle où on paye à l'exécution, sans gérer de serveurs. Scale automatique.

### Bandwidth
Bande passante : volume de données transférées.

### Compute
Ressources CPU consommées.

### Plan B
Stratégie de secours si le plan principal échoue (ici : migration hors Cloudflare en 5-7 jours).

---

## 10. Notes sur les paliers de scale du document

| Palier | Sens concret |
|---|---|
| **0 → 10k MAU** | Phase de lancement, tout gratuit. |
| **10k → 50k MAU** | La BDD devient le goulet → payer Supabase Pro. |
| **50k → 500k MAU** | Trop de requêtes Workers → plan payant Workers. |
| **500k → 5M MAU** | Les écritures BDD saturent → réplicas + partitionnement. |
| **5M+ MAU** | Sharding / BDD distribuée → vrai budget infra. |

---

*Document de référence : `ghost-social-architecture.pdf` (consulté 2026-04-24).*
