# ADR 0003 : Authentification par signature Ed25519 client-side

**Statut :** Accepté
**Date :** 2026-05-07
**Auteurs :** Artus, Vitrice

---

## Contexte

L'ADR-0002 fixe le cap : aucune PII collectée, identité par hash de clé publique. Cet ADR précise *comment* nous implémentons cette identité et *pourquoi* nous avons choisi Ed25519 plutôt que d'autres primitives cryptographiques.

Contraintes :
- WebCrypto disponible côté navigateur. Pas de bibliothèque crypto bundlée si on peut l'éviter (poids, surface d'attaque).
- Identité doit être stable, vérifiable côté serveur sans secret partagé, dérivable d'une phrase mnémonique pour la récupération côté utilisateur.
- Distinction nécessaire entre **signature d'authentification** (prouver « je suis le détenteur de cette clé » à chaque requête) et **chiffrement bout-en-bout des DM** (dériver une clé symétrique partagée entre deux pairs).

---

## Options envisagées

### Option A — RSA-2048 ou ECDSA P-256

- **RSA-2048 :** trop lourd côté navigateur (clés 256 octets, signatures lentes). Rejeté.
- **ECDSA P-256 :** bien supporté par WebCrypto depuis longtemps. Mais les signatures déterministes ne sont pas garanties (RFC 6979 non imposée par la spec WebCrypto), risque historique de fuite de clé sur mauvaise génération de nonce.

### Option B — Ed25519 (Edwards-curve Digital Signature Algorithm) + X25519 (ECDH curve25519)

- **Ed25519 :** signatures déterministes par construction (pas de risque de nonce), clés courtes (32 octets pour la pubkey, 32 pour la privée), vérification rapide, standard utilisé par SSH, Signal, Nostr (~33M de pubkeys en prod). Supporté par WebCrypto depuis fin 2024 sans flag dans Chrome 133+, Firefox 130+, Safari 17+ (cf. *Web Cryptography Curve25519 spec, draft-irtf-cfrg-eddsa-08*).
- **X25519 :** ECDH sur la même famille de courbe. Permet de dériver une clé partagée AES-GCM 256 entre deux pairs sans aucun échange de secret. Idéal pour les DM E2EE.

### Option C — Ed25519 seul, dériver X25519 par conversion (libsodium-style)

Une seule clé Ed25519 utilisée à la fois pour signer et — après conversion mathématique — pour dériver des clés partagées via X25519 (`crypto_sign_ed25519_pk_to_curve25519`).

- **Avantages :** une seule clé à gérer côté utilisateur, une seule phrase mnémonique.
- **Inconvénients :** la conversion exige une bibliothèque externe (libsodium-wrappers ~100 KB) puisque WebCrypto ne l'expose pas. Mauvais cryptographic hygiene de réutiliser la même clé pour signature et accord de clé (recommandation NIST SP 800-57 : une clé, un usage).

### Option D — JWT avec secret partagé serveur

Auth classique : login avec mot de passe → JWT signé par le serveur → cookie HttpOnly.

- **Inconvénients :** rompt l'anonymat (le serveur a un secret qui « connaît » l'utilisateur), exige un mot de passe (donc un mécanisme de récupération qui exige une PII de récupération comme l'email). Rejeté immédiatement.

---

## Décision

**Option B :** deux keypairs distincts générés à l'onboarding.

- **Keypair Ed25519** pour la signature d'authentification. Chaque requête mutante (POST/PATCH/DELETE) inclut un header `X-Signature` au format `<timestamp>.<signature_base64>` où la signature couvre `<method>.<path>.<timestamp>.<sha256(body)>`. Le timestamp doit être à moins de 60 secondes pour empêcher le replay.

- **Keypair X25519** pour l'accord de clé E2EE des DM. Pour envoyer un DM à un pair, on récupère sa pubkey X25519 via le directory, on dérive une clé AES-GCM 256 par ECDH, on chiffre, on envoie `{iv, cipher}`. Le serveur ne stocke que les blobs chiffrés.

L'identité publique exposée côté serveur est `sha256(rawEd25519PubKey)` en hex 64 chars — c'est ce qu'on appelle `publicHash` dans le schéma.

Les deux pubkeys (Ed25519 raw 32 octets et X25519 raw 32 octets) sont publiées dans le directory `users` côté Supabase, pour que les pairs puissent vérifier les signatures et dériver les clés DM.

À l'onboarding, l'utilisateur reçoit une **phrase mnémonique BIP-39 de 12 mots** (128 bits d'entropie) qui sert de seed à un PRNG cryptographique déterministe duquel sont dérivées les deux clés privées. Cette phrase est la *seule* méthode de récupération si la clé privée locale est perdue (changement d'appareil, vidage de cache).

---

## Implémentation

### Côté client (`src/lib/crypto.ts`)

```ts
// Génération initiale (à l'onboarding)
const edKeyPair = await crypto.subtle.generateKey(
  { name: "Ed25519" },
  true,
  ["sign", "verify"],
);
const xKeyPair = await crypto.subtle.generateKey(
  { name: "X25519" },
  true,
  ["deriveKey", "deriveBits"],
);

// Signature d'une requête sortante
async function signRequest(method: string, path: string, body: string) {
  const timestamp = Date.now().toString();
  const bodyHash = await sha256(body);
  const message = `${method}.${path}.${timestamp}.${bodyHash}`;
  const signature = await crypto.subtle.sign(
    "Ed25519",
    edKeyPair.privateKey,
    new TextEncoder().encode(message),
  );
  return `${timestamp}.${bytesToBase64(new Uint8Array(signature))}`;
}
```

### Côté serveur (Worker / Express)

```js
async function verifySignature(pubkeyRawBase64, headerValue, method, path, body) {
  const [timestamp, signatureB64] = headerValue.split(".");
  const age = Math.abs(Date.now() - Number(timestamp));
  if (Number.isNaN(age) || age > 60_000) {
    throw http(401, "Signature expirée");
  }
  const bodyHash = await sha256(body || "");
  const message = `${method}.${path}.${timestamp}.${bodyHash}`;
  const pubkey = await crypto.subtle.importKey(
    "raw",
    base64ToBytes(pubkeyRawBase64),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  const ok = await crypto.subtle.verify(
    "Ed25519",
    pubkey,
    base64ToBytes(signatureB64),
    new TextEncoder().encode(message),
  );
  if (!ok) throw http(401, "Signature invalide");
}
```

### Stockage des clés privées

Détaillé dans le code, mais en résumé : les deux clés privées (`Ed25519` et `X25519`) sont exportées en JWK, sérialisées en JSON, chiffrées par AES-GCM avec une clé dérivée d'un mot de passe local via PBKDF2 (210 000 itérations, paramètres OWASP 2025), puis stockées dans IndexedDB. Le mot de passe n'est jamais transmis hors de l'appareil.

À l'ouverture de l'app, l'utilisateur saisit son mot de passe local, on déchiffre les clés en mémoire pour la durée de la session.

---

## Conséquences

- **Positives :**
  - Signatures vérifiables sans secret partagé. Le serveur n'a *que* la pubkey, pas de moyen d'usurper l'identité d'un utilisateur.
  - Replay protection par timestamp + nonce implicite (sha256 du body).
  - Pas de session côté serveur — chaque requête est self-contained. Stateless natif, scalabilité horizontale gratuite.
  - Empreinte client minimale : WebCrypto natif, pas de libsodium ni d'autre lib crypto bundlée.
  - Récupération possible via mnémonique BIP-39 sans rompre l'anonymat (la mnémonique ne quitte pas l'appareil et n'est jamais montrée au serveur).

- **Négatives :**
  - Compatibilité navigateur : Ed25519 et X25519 dans WebCrypto sans flag depuis 2024 mais Safari 16 et antérieurs ne supportent pas. Mitigation : afficher un message clair de mise à jour navigateur, fournir une indication des versions minimales (Chrome 133, Firefox 130, Safari 17, Edge 133).
  - Si l'utilisateur perd sa mnémonique *et* sa clé privée locale, perte totale du compte. Impossible à récupérer côté serveur.
  - Le timestamp client doit être à peu près synchronisé (60 s de marge). Si l'horloge client est complètement décalée, l'auth échoue. Mitigation : synchroniser via le `Date` header HTTP de la première réponse.

- **Risques :**
  - Vulnérabilité future dans Ed25519 ou X25519. Probabilité très faible (primitives cryptographiques très éprouvées). Mitigation : rotation de clé possible (l'utilisateur génère une nouvelle paire et migre son contenu).
  - Faille dans l'implémentation WebCrypto d'un navigateur. Impact = utilisateurs de ce navigateur compromis. Mitigation : monitoring CVE WebCrypto, message d'alerte aux utilisateurs.
  - Chiffrement IndexedDB cassé par PBKDF2 mal paramétré ou mot de passe local trop faible. Mitigation : 210k itérations PBKDF2, indicateur de force du mot de passe à l'onboarding.

- **Réversibilité :**
  Migration vers une autre primitive de signature (par exemple Ed448 si Ed25519 venait à être déprécié) coûterait une rotation de clé pour tous les utilisateurs : génération nouvelle paire, signature de transition par l'ancienne, migration progressive. Estimable à 1 sprint de dev + une période de migration côté utilisateur. Pas de perte de contenu (le contenu est attaché à des hashes de pubkey, qu'on peut faire pointer vers les nouvelles clés via une signature de transition).
