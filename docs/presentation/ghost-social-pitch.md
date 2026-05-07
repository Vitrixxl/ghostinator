# Ghost Social — Script d'oral (5 min)

> Indications scéniques en *italique*. Cibles de timing à gauche. Débit conseillé : ~150 mots/minute. Respirer entre les blocs.


## \[00:00\] — Le hook (30 s)

*Schéma masqué.*

Imaginez un réseau social où nous, les opérateurs, ne savons **rien** de vous. Pas votre email. Pas votre numéro. Pas votre IP. Pas votre appareil. Un réseau social où — même sous réquisition judiciaire — nous n'avons littéralement **rien à donner**, parce qu'il n'y a rien à savoir.

C'est Ghost Social. Et le défi technique qu'on a relevé, ce n'est pas de coder ce produit. C'est de le coder **avec un budget de zéro euro par mois**.

Ces deux contraintes — anonymat total et bootstrappé — sont en apparence contradictoires. Tout ce qui est gratuit dans le cloud aujourd'hui est gratuit *parce que* ça collecte de la donnée. On a dû construire à contre-courant.


## \[00:30\] — Les deux contraintes, vraiment (30 s)

*Toujours sans schéma. Énumérer en regardant le jury.*

**Anonymat total**, ça veut dire trois choses concrètes :

- Pas de PII collectée. Jamais.

- Pas d'IP loggée — même sur les logs CDN.

- Aucun identifiant côté serveur que je puisse corréler à une personne physique.

**Budget zéro**, ça veut dire :

- Aucun service qui exige une carte bancaire pour démarrer.

- Aucune dépendance qui devient payante avant 10 000 utilisateurs actifs.

- Une trajectoire de scale qui *prévoit* la croissance sans réécriture.

Ces deux contraintes ont disqualifié 80% du marché. Firebase, AWS, Auth0 : tous écartés au premier round.


## \[01:00\] — L'architecture, vue d'ensemble **Bun sur Hetzner CX23 (Falkenstein)**(1 min 30)

*Afficher le schéma. Pointer chaque bloc en parlant.*

Voici l'architecture. Trois étages, lus de haut en bas.

**En haut, l'utilisateur** — sur une PWA, une Progressive Web App. Pas d'App Store, pas de compte Google ni Apple. L'utilisateur installe l'app via une URL, comme on bookmark un site. Et c'est dans son navigateur — *pas* sur notre serveur — que se passe la chose la plus importante du système : la génération d'une **paire de clés cryptographique Ed25519**. La clé privée reste sur l'appareil, chiffrée dans IndexedDB. La clé publique sert d'identifiant. On ne stocke que son hash. Ça veut dire qu'on ne peut **techniquement pas** ré-identifier un utilisateur — pas par choix politique, par construction mathématique.

**Au milieu, Cloudflare**. C'est le cœur de notre stratégie « zéro euro ». Pages héberge la PWA — bandwidth illimité gratuit. Le proxy applique un **Managed Transform** qui supprime le header `CF-Connecting-IP` avant qu'il atteigne notre origine. *C'est cette frontière, en rouge sur le schéma, où l'IP du client disparaît définitivement.* Turnstile remplace le CAPTCHA — sans cookie, sans fingerprint, conforme RGPD. Et les Workers — V8 isolates, **moins d'une milliseconde de cold start**, soit cent fois plus rapide que Lambda — exécutent toute notre logique : vérification de signature, rate-limit basé sur un hash rotatif, proof-of-work anti-spam, et stripping des EXIF avant upload.

**En bas, deux stockages**. À gauche, **Supabase** : Postgres 500 MB, Row-Level Security pour qu'une signature ne puisse accéder qu'à ses propres données, Realtime via WebSockets pour pousser le feed, Supavisor inclus pour le pooling. À droite, **Cloudflare R2** : 10 GB gratuits, et — l'argument décisif — **egress à zéro euro pour toujours**. Si un post devient viral et génère un téraoctet de téléchargements, notre facture reste à zéro. Sur S3, ce serait 90 dollars.


## \[02:30\] — Pourquoi ces choix précis (1 min 30)

*Garder le schéma affiché.*

Trois questions pourraient vous venir. Je les anticipe.

**Pourquoi Ed25519 et pas un OAuth classique ?** Parce qu'OAuth, c'est juste **déléguer** l'identification à Google ou Apple. Le problème n'est pas résolu, il est déplacé. Avec Ed25519 généré côté client, **personne** n'a l'identité — pas même nous. C'est le modèle de Nostr, qui tourne en production avec près d'un million de profils actifs et trente-trois millions de clés publiques. Le protocole est éprouvé. Le trade-off : perte de clé égale perte de compte. On l'assume — toute procédure de récupération serveur ouvrirait un backdoor d'identification.

**Pourquoi tout sur Cloudflare et pas du multi-cloud ?** Parce que la portabilité est dans le code, pas dans l'infra. Postgres est standard, R2 est S3-compatible, les Workers sont du JavaScript portable. Si Cloudflare devient hostile — pricing, policy — on bascule en cinq jours sur un VPS Hetzner à 3,49 euros par mois et Backblaze B2, qui d'ailleurs a un accord d'egress gratuit avec Cloudflare via la Bandwidth Alliance. Le verrouillage est mesuré.

**Pourquoi pas de Sentry ?** Parce que Sentry logue les IPs et les payloads utilisateur par défaut. Ça brise notre garantie d'anonymat. On utilise GlitchTip, fork open-source, **API-compatible avec les SDK Sentry** — donc drop-in — qu'on auto-héberge avec scrubbing agressif des PII.


## \[04:00\] — Si le trafic double demain (45 s)

*Pointer la zone de scale du schéma si pertinent.*

Dernière question critique : la scalabilité.

De zéro à dix mille utilisateurs actifs, on est à zéro euro. Au-delà, chaque palier est un **changement de plan**, pas une réarchitecture.

- Cinquante mille utilisateurs : Supabase Pro, vingt-cinq dollars par mois.

- Cinq cent mille : Workers Paid, cinq dollars plus trente centimes par million de requêtes.

- Cinq millions : read-replicas, partitionnement par hash de clé publique, environ deux cents dollars par mois.

- Au-delà : on vient vous voir avec ces métriques, et on lève une seed.

L'architecture supporte nativement chaque palier. Aucun point ne demande une réécriture.


## \[04:45\] — La clôture (15 s)

*Regarder le jury, sans le schéma.*

Ghost Social, c'est un produit qui ne peut pas trahir ses utilisateurs — parce qu'il ne sait rien d'eux. C'est une stack qui ne peut pas exploser le budget — parce qu'elle est conçue pour scaler par paliers prévus. Et c'est livrable en deux semaines par un seul développeur.

*Pause. Sourire.*

Vos questions ?


## Annexe : trois lignes à se répéter avant l'oral

1. « Pas par choix politique, par construction mathématique. » — pour parler de l'anonymat.

2. « Egress à zéro euro pour toujours. » — pour R2.

3. « Changement de plan, pas réarchitecture. » — pour la scalabilité.

