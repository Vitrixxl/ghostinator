# ADR 0002 : Anonymisation totale et auditabilité légale

**Statut :** Accepté
**Date :** 2026-05-07
**Auteurs :** Artus, Vitrice
**ADR obligatoire (brief §2.3.2) :** oui — réponse à la contrainte spécifique principale du groupe 8

---

## Contexte

La contrainte du sujet est explicite (brief §3.4.4) :

> *Pour le groupe 8 (réseau social fantôme) : votre contrainte est l'anonymisation totale des informations utilisateurs. Vous devez aussi pouvoir auditer toutes les actions pour répondre à une éventuelle réquisition légale (publication illégale, harcèlement, fraude).*

Le brief identifie lui-même que ces deux exigences sont en tension et liste les questions auxquelles nous devons savoir répondre :

> *Que se passe-t-il en cas de réquisition légale ? Comment empêchez-vous le harcèlement entre utilisateurs si vous ne savez pas qui ils sont ? Votre approche tient-elle juridiquement ? Sous quelle juridiction ?*

Notre lecture du brief : ces deux exigences ne peuvent pas être conciliées *complètement*. Toute architecture qui prétend offrir 100 % d'anonymat *et* 100 % d'auditabilité légale ré-identifiable ment sur l'une des deux. Le travail consiste à choisir un point d'équilibre défendable, à le documenter, et à en assumer les conséquences.

---

## Options envisagées

### Option A — Pseudonymisation cryptographique réversible avec clés détenues par un tiers

L'identité utilisateur est dérivée de PII (téléphone, IP) chiffrées avec une clé de séquestre détenue par un tiers de confiance (huissier, autorité indépendante). Sur réquisition légale validée, le tiers déchiffre et fournit l'identité.

- **Avantages :** auditabilité totale possible.
- **Inconvénients :** **rompt l'anonymat by design**. Le tiers de confiance *peut* identifier — donc la promesse « le serveur ne peut pas vous ré-identifier » est fausse. Crée un single point of failure pour la vie privée. Rejeté immédiatement.

### Option B — Identité cryptographique côté client, aucune PII collectée, auditabilité sur le contenu seul

Chaque utilisateur génère un keypair Ed25519 dans son navigateur (WebCrypto). La clé privée ne quitte jamais l'appareil (stockée chiffrée dans IndexedDB). L'identifiant côté serveur est `hash(pubkey)`. Aucune PII n'est jamais collectée. L'IP est strippée à l'edge avant d'atteindre l'origine.

L'auditabilité est restreinte à ce que nous *avons* :

- Le contenu public publié (posts, métadonnées de publication, hash de pubkey de l'auteur).
- Les actions effectuées par un hash de pubkey (séquence d'événements signés Ed25519).
- *Aucune* corrélation à une personne physique.

- **Avantages :** anonymat *par construction mathématique* (pas par politique interne). Sous réquisition, nous ne pouvons fournir que ce que nous avons : du contenu déjà public + un graphe d'actions par hash. Conforme à la promesse produit.
- **Inconvénients :** auditabilité légale incomplète au sens classique. Nous ne pouvons pas répondre à une réquisition qui demande « qui est cet utilisateur » — nous ne le savons pas. Cette limite doit être inscrite explicitement dans les CGU.

### Option C — Logs anonymes corrélables via réquisition (secret rotatif côté serveur)

Le serveur loggue les actions sous forme `hash(pubkey + jour + secret_rotatif)`. Le secret tourne quotidiennement. Sur réquisition, l'autorité fournit un mandat ; le serveur peut alors corréler les actions d'une journée donnée *si elle a ce hash de référence*.

- **Avantages :** une forme de traçabilité limitée dans le temps (une journée).
- **Inconvénients :** ne ré-identifie *toujours pas* une personne physique. Donne une fausse impression de capacité d'audit. Fait peser un secret côté serveur dont la fuite réintroduirait de la corrélation. Ajoute de la complexité sans bénéfice juridique réel.

### Option D — Modèle hybride : anonymat par défaut + logs publics signés pour les modérateurs

Toutes les actions publiques (post, signalement, modération) sont signées Ed25519 par leur auteur et publiées dans un journal vérifiable. Les modérateurs sont aussi des hashes de pubkey. Sur réquisition, on fournit le journal complet — qui ne ré-identifie personne mais documente publiquement *qui a fait quoi* (au sens cryptographique : tel hash de pubkey a posté tel contenu, tel hash de pubkey l'a signalé, tel hash de pubkey l'a masqué).

- **Avantages :** auditabilité réelle de la modération elle-même, transparence publique des actions de plateforme. Anti-corruption interne : un admin ne peut pas masquer des actions qu'il a effectuées.
- **Inconvénients :** complexité de mise en œuvre (journal append-only). Pas dans le scope MVP.

---

## Décision

**Option B en MVP, avec brique D au palier suivant.**

Concrètement pour la version livrée :

1. **Identité Ed25519 client-side.** Génération `crypto.subtle.generateKey({name: "Ed25519"})` côté navigateur. Clé privée stockée chiffrée dans IndexedDB par AES-GCM dérivé d'un mot de passe local (PBKDF2). Clé publique publiée dans le directory. Identifiant = `sha256(rawPublicKey)` exposé en hex 64 chars.

2. **Aucune PII collectée.** Pas d'email, pas de téléphone, pas de nom réel demandé. Le seul champ texte attribuable est `username` (case-insensitive, 2–32 chars), qui n'est pas vérifié comme étant un nom réel et que les CGU décrivent explicitement comme un pseudonyme libre.

3. **IP strippée à l'edge.** Cloudflare Managed Transform « Remove visitor IP headers » activé. Côté Worker, vérification défensive : si `CF-Connecting-IP` arrive malgré tout, on le drop avant tout traitement. Aucun log applicatif n'a accès à l'IP.

4. **Pas d'analytics intrusif.** Cloudflare Web Analytics (sans cookie, sans fingerprint, sans IP). Pas de Sentry (rejeté car logue les payloads). Si erreur tracking nécessaire en M+1 : GlitchTip self-hosted sur le VPS de plan B avec scrubbing PII agressif.

5. **Modération sans identité.** Proof-of-Work léger (~18 bits, ~200 ms CPU) à la création de compte et à la création de post. Rate-limit par `hash(pubkey + jour + secret_rotatif)`. Signalements communautaires avec seuil de masquage automatique. Shadowban réversible par hash de pubkey. Le modérateur ne voit jamais d'IP ni de PII, seulement le contenu et le hash de l'auteur.

6. **CGU explicites sur la limite d'auditabilité.** Notre réponse à toute réquisition légale est : nous fournissons le contenu public déjà publié et l'historique d'actions par hash de pubkey ; nous ne pouvons pas, par construction, ré-identifier l'auteur. Cette limite est inscrite dans les CGU à la signature.

Au palier suivant (post-MVP), ajout de la brique D : journal append-only des actions de modération signées, vérifiable publiquement.

---

## Réponses aux trois questions du brief §3.4.4

### « Que se passe-t-il en cas de réquisition légale ? »

Nous fournissons :
- Le contenu public déjà publié sur la plateforme (qui est de toute façon public).
- L'historique d'actions associées à un hash de pubkey donné (date, type d'action, contenu).

Nous ne fournissons *pas* :
- L'identité civile derrière un hash — nous ne la connaissons pas.
- L'IP de l'auteur — nous ne la stockons pas (strippée à l'edge).
- Les DM — chiffrés bout-en-bout par X25519 ECDH dérivé entre les pairs ; le serveur ne stocke que `{iv, cipher}` indéchiffrables sans les clés privées des participants.

Cette limite est conforme à l'article 11 du RGPD (principe de minimisation des données). Une autorité qui exige une donnée que nous ne possédons pas ne peut pas légalement nous obliger à la créer ou à modifier l'architecture pour la collecter rétroactivement.

### « Comment empêchez-vous le harcèlement entre utilisateurs si vous ne savez pas qui ils sont ? »

Le harcèlement intra-plateforme est traité **sans identité** :

- **Bloquer** : un utilisateur peut bloquer un hash de pubkey. Le hash ne pourra plus le contacter ni voir son contenu (filtrage côté client à la réception).
- **Signaler** : un seuil communautaire (par exemple 5 signalements distincts) déclenche un masquage automatique du contenu, en attente de revue.
- **Modération communautaire** : modérateurs bénévoles (eux-mêmes hashes de pubkey élus) qui voient le contenu signalé sans voir le hash de l'auteur, pour décider sur le contenu seul.
- **Shadowban réversible** : marquage du hash de pubkey concerné. L'utilisateur continue de poster mais ses messages ne sont plus visibles aux autres. Pas de ban IP (puisque pas d'IP), pas de ban d'identité (puisque pas d'identité).
- **Proof-of-Work** : créer un nouveau compte coûte ~200 ms CPU, créer un post coûte ~50 ms. Rendre le harcèlement de masse économiquement non viable, pas mathématiquement impossible.

Honnêteté intellectuelle : ce système ne garantit pas qu'un harceleur déterminé ne pourra pas créer 100 comptes manuellement. Il vise à éliminer 99 % du bruit. C'est un trade-off assumé du produit, inscrit dans les CGU.

### « Votre approche tient-elle juridiquement ? Sous quelle juridiction ? »

**Juridiction :** France (siège social), donc droit français + RGPD européen + ePrivacy. Hébergement Supabase EU Frankfurt (Allemagne) + Cloudflare réseau global mais pop EU prioritaire pour l'Europe.

**Tient-elle juridiquement ?** Oui, sous réserves :

- **RGPD article 11** (« Traitement ne nécessitant pas l'identification ») : nous appliquons cet article à la lettre. Le responsable de traitement n'est pas tenu de conserver, d'obtenir ou de traiter des informations supplémentaires pour identifier la personne concernée à la seule fin de respecter le règlement. Notre architecture est conçue pour ne pas pouvoir ré-identifier — ce qui est un cas explicitement prévu.
- **Réquisition judiciaire (Code de procédure pénale article 60-1 et suivants) :** une réquisition ne peut nous obliger à fournir que des données *que nous détenons*. Nous fournissons ce que nous avons (contenu public, hashes d'actions) ; nous ne sommes pas obligés de modifier l'architecture pour collecter ce que nous ne collectons pas.
- **Loi pour une République numérique 2016 + LCEN (loi pour la confiance dans l'économie numérique) :** notre obligation en tant qu'hébergeur est de retirer les contenus manifestement illicites sur signalement, ce que nous faisons via la modération communautaire. Pas d'obligation générale de surveillance (CJUE Scarlet Extended).
- **Données de connexion (article L34-1 CPCE) :** la conservation des données de connexion (IP, identifiants) pour 1 an n'est applicable qu'aux opérateurs de communications électroniques au sens de l'article L32 CPCE. Un service de réseau social n'est pas un opérateur de communications électroniques au sens de cette définition (CJUE La Quadrature du Net 2020, qui restreint fortement l'obligation de conservation généralisée). Notre lecture : nous ne sommes pas tenus de conserver les IP que nous ne collectons déjà pas.

**Risques résiduels :** une jurisprudence future pourrait imposer une obligation de collecte d'identifiants pour les réseaux sociaux (cf. débats récurrents en Europe). Si cela arrivait, nous devrions soit nous y conformer (en perdant la promesse), soit migrer la juridiction (Suisse, Islande). Cette éventualité est inscrite dans les CGU comme cas de cessation potentielle du service.

---

## Conséquences

- **Positives :**
  - Promesse d'anonymat tenable mathématiquement, pas seulement contractuellement.
  - Conformité RGPD by design (minimisation des données = donnée non collectée = donnée non risquée).
  - Aucun coût opérationnel de gestion de données à caractère personnel (pas de DPO requis pour l'absence de traitement de PII).
  - Narratif marketing différenciant : « le seul réseau social qui ne peut pas vous trahir, parce qu'il ne sait rien de vous ».

- **Négatives :**
  - Pas de récupération de compte. Perte de clé privée = perte de compte. Mitigation : phrase mnémonique BIP-39 à l'onboarding (12 mots), export/import dans les settings.
  - Auditabilité légale partielle. Limite assumée et inscrite dans les CGU.
  - Pas de KYC possible si une régulation future l'imposait. Risque de cessation de service dans cette juridiction.

- **Risques :**
  - Régulation future imposant l'identification des utilisateurs des réseaux sociaux. Probabilité moyenne, impact bloquant. Mitigation : veille juridique, juridiction de repli identifiée (Suisse, Islande).
  - Incident de harcèlement médiatisé qui crée une pression politique. Impact narratif fort. Mitigation : modération communautaire visible, transparence sur les volumes de signalements et de masquages.
  - Faille dans WebCrypto (Ed25519 ou X25519). Impact sécuritaire majeur. Mitigation : standards éprouvés, rotation de clé possible côté utilisateur, audit cryptographique externe en M+5 (pré-lancement public, voir `docs/presentation/ghost-social-plan-b.md` §M5).

- **Réversibilité :**
  Si nous voulions ajouter de l'auditabilité ré-identifiable, nous devrions casser la promesse d'anonymat — ce qui est un changement *de produit*, pas un changement d'architecture. Coût conceptuel énorme, coût technique modéré. Reverser dans l'autre sens (ajouter du chiffrement à un produit qui logue) est plus difficile : nous avons fait le bon choix dans le bon sens.

---

## Décisions filles

- ADR-0003 : Auth Ed25519 client-side (justifie le choix cryptographique précis).
- ADR-0004 : Supabase Postgres + Row-Level Security (justifie le cloisonnement des données par hash de pubkey).
