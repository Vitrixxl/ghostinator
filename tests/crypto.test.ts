import { describe, expect, it } from "vitest";

const enc = new TextEncoder();
const dec = new TextDecoder();

function bytesToBase64(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("base64");
}

function base64ToBytes(value: string) {
  return new Uint8Array(Buffer.from(value, "base64"));
}

async function countLeadingZeroBits(bytes: Uint8Array) {
  let zeros = 0;
  for (const byte of bytes) {
    if (byte === 0) {
      zeros += 8;
      continue;
    }
    let mask = 0x80;
    while (mask && (byte & mask) === 0) {
      zeros += 1;
      mask >>= 1;
    }
    return zeros;
  }
  return zeros;
}

async function computePow(challenge: string, bits: number) {
  for (let n = 0n; n < 1n << 32n; n += 1n) {
    const nonce = n.toString(36);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", enc.encode(challenge + nonce)),
    );
    if ((await countLeadingZeroBits(digest)) >= bits) return nonce;
  }
  throw new Error("PoW non trouvé");
}

describe("Ed25519 signature d'authentification", () => {
  it("signe et vérifie un message", async () => {
    const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;

    const message = "POST./api/posts.1714999999999.deadbeef";
    const sig = await crypto.subtle.sign(
      "Ed25519",
      keyPair.privateKey,
      enc.encode(message),
    );

    const ok = await crypto.subtle.verify(
      "Ed25519",
      keyPair.publicKey,
      sig,
      enc.encode(message),
    );
    expect(ok).toBe(true);
  });

  it("rejette un message altéré", async () => {
    const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const sig = await crypto.subtle.sign("Ed25519", keyPair.privateKey, enc.encode("a"));
    const ok = await crypto.subtle.verify(
      "Ed25519",
      keyPair.publicKey,
      sig,
      enc.encode("b"),
    );
    expect(ok).toBe(false);
  });

  it("export raw / import raw donne une pubkey vérifiable", async () => {
    const keyPair = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
      "sign",
      "verify",
    ])) as CryptoKeyPair;
    const raw = new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey));
    expect(raw.length).toBe(32);
    const reimported = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "Ed25519" },
      false,
      ["verify"],
    );
    const sig = await crypto.subtle.sign(
      "Ed25519",
      keyPair.privateKey,
      enc.encode("hello"),
    );
    const ok = await crypto.subtle.verify(
      "Ed25519",
      reimported,
      sig,
      enc.encode("hello"),
    );
    expect(ok).toBe(true);
  });
});

describe("X25519 ECDH pour DM E2EE", () => {
  it("Alice et Bob dérivent la même clé partagée", async () => {
    const alice = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
      "deriveKey",
      "deriveBits",
    ])) as CryptoKeyPair;
    const bob = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
      "deriveKey",
      "deriveBits",
    ])) as CryptoKeyPair;

    const sharedAlice = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "X25519", public: bob.publicKey },
        alice.privateKey,
        256,
      ),
    );
    const sharedBob = new Uint8Array(
      await crypto.subtle.deriveBits(
        { name: "X25519", public: alice.publicKey },
        bob.privateKey,
        256,
      ),
    );

    expect(bytesToBase64(sharedAlice)).toBe(bytesToBase64(sharedBob));
  });

  it("Round-trip chiffrement DM via clé dérivée", async () => {
    const alice = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
      "deriveKey",
    ])) as CryptoKeyPair;
    const bob = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
      "deriveKey",
    ])) as CryptoKeyPair;

    async function deriveAesKey(
      privateKey: CryptoKey,
      peerPubKey: CryptoKey,
    ) {
      return crypto.subtle.deriveKey(
        { name: "X25519", public: peerPubKey },
        privateKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"],
      );
    }

    const aliceKey = await deriveAesKey(alice.privateKey, bob.publicKey);
    const bobKey = await deriveAesKey(bob.privateKey, alice.publicKey);

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      aliceKey,
      enc.encode("Le bureau est ouvert."),
    );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      bobKey,
      cipher,
    );

    expect(dec.decode(plain)).toBe("Le bureau est ouvert.");
  });
});

describe("Proof-of-Work Hashcash", () => {
  it("trouve un nonce pour une difficulté faible (8 bits)", async () => {
    const challenge = "test:abc";
    const nonce = await computePow(challenge, 8);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", enc.encode(challenge + nonce)),
    );
    const zeros = await countLeadingZeroBits(digest);
    expect(zeros).toBeGreaterThanOrEqual(8);
  });

  it("rejette un nonce trop facile pour bits demandés", async () => {
    const challenge = "test:xyz";
    const nonce = await computePow(challenge, 4);
    const digest = new Uint8Array(
      await crypto.subtle.digest("SHA-256", enc.encode(challenge + nonce)),
    );
    const zeros = await countLeadingZeroBits(digest);
    // Le nonce trouvé satisfait 4 bits mais pas forcément 24.
    expect(zeros).toBeGreaterThanOrEqual(4);
    expect(zeros).toBeLessThan(24);
  });
});

describe("AES-GCM 256 (clé symétrique de groupe)", () => {
  it("Round-trip chiffrement avec une clé brute", async () => {
    const raw = crypto.getRandomValues(new Uint8Array(32));
    const key = await crypto.subtle.importKey(
      "raw",
      raw,
      { name: "AES-GCM" },
      false,
      ["encrypt", "decrypt"],
    );
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      enc.encode("intro de cercle"),
    );
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      cipher,
    );
    expect(dec.decode(plain)).toBe("intro de cercle");
  });

  it("Refuse de déchiffrer avec une clé différente", async () => {
    const raw1 = crypto.getRandomValues(new Uint8Array(32));
    const raw2 = crypto.getRandomValues(new Uint8Array(32));
    const k1 = await crypto.subtle.importKey("raw", raw1, "AES-GCM", false, ["encrypt"]);
    const k2 = await crypto.subtle.importKey("raw", raw2, "AES-GCM", false, ["decrypt"]);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const cipher = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      k1,
      enc.encode("secret"),
    );
    await expect(
      crypto.subtle.decrypt({ name: "AES-GCM", iv }, k2, cipher),
    ).rejects.toThrow();
  });
});

describe("Helpers byte (compatibilité front/back)", () => {
  it("base64 round-trip preserves bytes", () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 0, 128]);
    const b64 = bytesToBase64(bytes);
    const back = base64ToBytes(b64);
    expect(Array.from(back)).toEqual(Array.from(bytes));
  });

  it("counts leading zero bits correctly", async () => {
    expect(await countLeadingZeroBits(new Uint8Array([0, 0, 0xff]))).toBe(16);
    expect(await countLeadingZeroBits(new Uint8Array([0x01]))).toBe(7);
    expect(await countLeadingZeroBits(new Uint8Array([0xff]))).toBe(0);
    expect(await countLeadingZeroBits(new Uint8Array([0x00, 0x40]))).toBe(8 + 1);
  });
});
