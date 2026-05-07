/* IndexedDB chiffré : stocke le blob d'identité (clé privée chiffrée AES-GCM
   dérivée d'un mot de passe local PBKDF2) et les clés symétriques de groupe. */

const DB_NAME = "ghostinator";
const DB_VERSION = 1;
const STORE_IDENTITY = "identity";
const STORE_GROUP_KEYS = "group_keys";

export type EncryptedBlob = {
  salt: string;
  iv: string;
  cipher: string;
  version: number;
};

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_IDENTITY)) {
        db.createObjectStore(STORE_IDENTITY);
      }
      if (!db.objectStoreNames.contains(STORE_GROUP_KEYS)) {
        db.createObjectStore(STORE_GROUP_KEYS);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function withStore<T>(
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openDb();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const IDENTITY_KEY = "current";

export async function saveEncryptedIdentity(blob: EncryptedBlob): Promise<void> {
  await withStore(STORE_IDENTITY, "readwrite", (store) => store.put(blob, IDENTITY_KEY));
}

export async function loadEncryptedIdentity(): Promise<EncryptedBlob | null> {
  const result = await withStore<EncryptedBlob | undefined>(
    STORE_IDENTITY,
    "readonly",
    (store) => store.get(IDENTITY_KEY) as IDBRequest<EncryptedBlob | undefined>,
  );
  return result || null;
}

export async function clearEncryptedIdentity(): Promise<void> {
  await withStore(STORE_IDENTITY, "readwrite", (store) => store.delete(IDENTITY_KEY));
}

export async function saveEncryptedGroupKey(
  groupId: string,
  blob: EncryptedBlob,
): Promise<void> {
  await withStore(STORE_GROUP_KEYS, "readwrite", (store) => store.put(blob, groupId));
}

export async function loadEncryptedGroupKey(groupId: string): Promise<EncryptedBlob | null> {
  const result = await withStore<EncryptedBlob | undefined>(
    STORE_GROUP_KEYS,
    "readonly",
    (store) => store.get(groupId) as IDBRequest<EncryptedBlob | undefined>,
  );
  return result || null;
}
