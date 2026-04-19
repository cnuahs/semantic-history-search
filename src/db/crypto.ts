// cryptographic utilities for key management and document encryption

// 2026-04-08 - Shaun L. Cloherty <s.cloherty@ieee.org>

// derive an AES-GCM encryption key from the masterKey (HMAC-SHA256) via HKDF
//
// the masterKey is used directly for HMAC-SHA256 bookmark IDs; a separate
// AES-GCM key is derived for document encryption to ensure cryptographic
// independence between the two uses of the same underlying key material
export async function deriveEncryptionKey(masterKey: CryptoKey): Promise<CryptoKey> {
  // re-export the masterKey raw bytes so we can use them as HKDF input
  const raw = await crypto.subtle.exportKey('raw', masterKey);

  const hkdfKey = await crypto.subtle.importKey(
    'raw',
    raw,
    { name: 'HKDF' },
    false, // not extractable
    ['deriveKey'],
  );

  return crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: new Uint8Array(32), // zero salt — key material is already a strong random secret
      info: new TextEncoder().encode('shs-encryption'),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable
    ['encrypt', 'decrypt'],
  );
}

// generate a new masterKey and store in chrome.storage.local
export async function generateMasterKey(): Promise<CryptoKey> {
  const masterKey = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign'],
  );
  const raw = await crypto.subtle.exportKey('raw', masterKey);
  await chrome.storage.local.set({ masterKey: Array.from(new Uint8Array(raw)) });
  console.log('crypto.generateMasterKey(): masterKey generated and stored.');
  return masterKey;
}

// import a masterKey from a hex string (used during join existing sync setup)
export async function importMasterKey(hex: string): Promise<CryptoKey> {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  const masterKey = await crypto.subtle.importKey(
    'raw',
    bytes,
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign'],
  );
  await chrome.storage.local.set({ masterKey: Array.from(bytes) });
  console.log('crypto.importMasterKey(): masterKey imported and stored.');
  return masterKey;
}

//
// document encryption/decryption for CouchDB sync
//
// encrypted documents have the form: { _id, _rev, payload: base64(nonce || ciphertext) }
// the nonce is a random 96-bit (12 byte) value, generated fresh for each encryption
//

function toBase64(buf: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)));
}

function fromBase64(str: string): Uint8Array {
  return Uint8Array.from(atob(str), c => c.charCodeAt(0));
}

// encrypt a PouchDB document for storage in CouchDB
//
// _id and _rev are left in plaintext (required by CouchDB/PouchDB for replication)
// all other fields are encrypted into a single 'payload' field
export async function encryptDoc(doc: Record<string, any>, key: CryptoKey): Promise<Record<string, any>> {
  const { _id, _rev, ...rest } = doc;

  const nonce = crypto.getRandomValues(new Uint8Array(12)); // 96-bit nonce
  const plaintext = new TextEncoder().encode(JSON.stringify(rest));

  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    plaintext,
  );

  // pack nonce and ciphertext together: payload = base64(nonce || ciphertext)
  const payload = new Uint8Array(nonce.byteLength + ciphertext.byteLength);
  payload.set(nonce, 0);
  payload.set(new Uint8Array(ciphertext), nonce.byteLength);

  return { _id, _rev, payload: toBase64(payload.buffer) };
}

// decrypt a PouchDB document received from CouchDB
//
// if the document has no 'payload' field it is returned as-is (e.g. design documents)
export async function decryptDoc(doc: Record<string, any>, key: CryptoKey): Promise<Record<string, any>> {
  if (!doc['payload']) return doc; // not an encrypted document

  const { _id, _rev } = doc;
  const payload = doc['payload'] as string;

  const bytes = fromBase64(payload);
  const nonce = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);

  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: nonce },
    key,
    ciphertext,
  );

  const rest = JSON.parse(new TextDecoder().decode(plaintext));

  return { _id, _rev, ...rest };
}
