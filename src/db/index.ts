// database instance for bookmark persistance

// 2026-03-10 - Shaun L. Cloherty <s.cloherty@ieee.org>

import PouchDB from 'pouchdb';
import pouchdbUpsert from 'pouchdb-upsert';

PouchDB.plugin(pouchdbUpsert);

export const db = new PouchDB('shs-bookmarks');

//
// metadata document helpers
//

export async function getMeta(): Promise<Record<string, any>> {
  try {
    const doc = await db.get('meta') as any;
    return doc;
  } catch {
    return {};
  }
}

export async function setMeta(fields: Record<string, any>): Promise<void> {
  await db.upsert('meta', (doc) => ({ ...doc, ...fields }));
}

//
// encryption
//

// possible encryption states:
//
//   'unconfigured' — encryption/passphrase never configures, SHA-256 IDs in use,
//   'locked'       — encryption/passphrase configured but passphrase not yet entered in this session,
//   'unlocked'     — encryption/passphrase configures, and masterKey active, HMAC IDs in use.
type EncryptionState = 'unconfigured' | 'locked' | 'unlocked';

let _encryptionState: EncryptionState = 'unconfigured';
let _masterKey: CryptoKey | null = null;

export function getEncryptionState(): EncryptionState {
  return _encryptionState;
}

export function getMasterKey(): CryptoKey | null {
  return _masterKey;
}

// private — only called within this module
function setMasterKey(key: CryptoKey | null): void {
  _masterKey = key;
  _encryptionState = key ? 'unlocked' : 'locked';
}

//
// bookmark IDs
//

import { sha256Id, hmacId } from '../utils/id';

// calculate bookmark ID for the given href using the active scheme
//
// Throws if encryption is configured but locked — callers must not
// attempt to write bookmarks until the user has unlocked.
export async function bookmarkId(href: string): Promise<string> {
  switch (_encryptionState) {
    case 'unconfigured':
      return sha256Id(href);
    case 'locked':
      throw new Error('Encryption is locked. User must unlock before bookmarks can be written.'); // caller must handle this
    case 'unlocked':
      return hmacId(_masterKey!, href);
  }
}

//
// key derivation helpers (private)
//

const PBKDF2_ITERATIONS = 600_000;
const SALT_LENGTH = 32; // bytes

async function getOrCreateSalt(): Promise<Uint8Array<ArrayBuffer>> {
  const { encryptionSalt } = await chrome.storage.local.get('encryptionSalt');
  if (encryptionSalt) {
    const buf = new ArrayBuffer(Object.values(encryptionSalt).length);
    const arr = new Uint8Array(buf);
    arr.set(Object.values(encryptionSalt) as number[]);
    return arr;
  }
  const buf = new ArrayBuffer(SALT_LENGTH);
  const salt = new Uint8Array(buf);
  crypto.getRandomValues(salt);
  await chrome.storage.local.set({ encryptionSalt: Array.from(salt) });
  return salt;
}

// generate key encryption key (KEK; used to encrypt the master key) from the user's passphrase and the stored salt
async function deriveKEK(passphrase: string, salt: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(passphrase),
    'PBKDF2',
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // KEK is not extractable — only used to wrap/unwrap masterKey
    ['wrapKey', 'unwrapKey'],
  );
}

async function encryptMasterKey(masterKey: CryptoKey, kek: CryptoKey): Promise<{ ciphertext: ArrayBuffer, iv: Uint8Array<ArrayBuffer> }> {
  const iv = crypto.getRandomValues(new Uint8Array(new ArrayBuffer(12)));
  const ciphertext = await crypto.subtle.wrapKey('raw', masterKey, kek, { name: 'AES-GCM', iv });
  return { ciphertext, iv };
}

async function decryptMasterKey(ciphertext: ArrayBuffer, iv: Uint8Array<ArrayBuffer>, kek: CryptoKey): Promise<CryptoKey> {
  return crypto.subtle.unwrapKey(
    'raw',
    ciphertext,
    kek,
    { name: 'AES-GCM', iv },
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true, // extractable — needed so we can store it in chrome.storage.session
    ['sign'],
  );
}

//
// session storage helpers (private)
//

async function saveKeyToSession(key: CryptoKey): Promise<void> {
  const raw = await crypto.subtle.exportKey('raw', key);
  await chrome.storage.session.set({ encryptionKey: Array.from(new Uint8Array(raw)) });
}

async function loadKeyFromSession(): Promise<CryptoKey | null> {
  const { raw } = await chrome.storage.session.get('encryptionKey');
  if (!raw) return null;
  return crypto.subtle.importKey(
    'raw',
    new Uint8Array(Object.values(raw)),
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign'],
  );
}

//
// public key management API
//

// initialise encryption state on service worker startup
//
// note: must be called (and resolve?) before retriever initialisation...
export async function init(): Promise<void> {
  // check whether encryption has been configured
  const { encryptedMasterKey } = await chrome.storage.local.get('encryptedMasterKey');
  if (!encryptedMasterKey) {
    _encryptionState = 'unconfigured';
    return;
  }

  // encryption is configured — try to restore key from session storage
  const key = await loadKeyFromSession();
  if (key) {
    setMasterKey(key);
    console.log('db.init(): encryption unlocked (restored from session).');
  } else {
    _encryptionState = 'locked';
    console.log('db.init(): encryption locked (passphrase required).');
  }
}

// unlock with passphrase
// 
// On first call, generates and stores the masterKey. On subsequent calls, decrypts the stored masterKey.
// Throws if the passphrase is incorrect.
export async function unlock(passphrase: string): Promise<void> {
  const salt = await getOrCreateSalt();
  const kek = await deriveKEK(passphrase, salt);

  const { encryptedMasterKey } = await chrome.storage.local.get('encryptedMasterKey');

  let masterKey: CryptoKey;

  if (!encryptedMasterKey) {
    // first time — generate a new masterKey
    masterKey = await crypto.subtle.generateKey(
      { name: 'HMAC', hash: 'SHA-256', length: 256 }, // length?
      true, // extractable
      ['sign'],
    );
    const { ciphertext, iv } = await encryptMasterKey(masterKey, kek);
    await chrome.storage.local.set({
      encryptedMasterKey: Array.from(new Uint8Array(ciphertext)),
      encryptedMasterKeyIV: Array.from(iv),
    });
    console.log('db.unlock(): encryption configured, masterKey generated.');
  } else {
    // returning user — decrypt existing masterKey
    const { encryptedMasterKeyIV } = await chrome.storage.local.get('encryptedMasterKeyIV');
    
    const ivArr = Object.values(encryptedMasterKeyIV as Record<string, number>);
    const ivBuf = new ArrayBuffer(ivArr.length);
    const iv = new Uint8Array(ivBuf);
    iv.set(ivArr);
    
    const ciphertext = new Uint8Array(Object.values(encryptedMasterKey as Record<string, number>)).buffer;
    
    masterKey = await decryptMasterKey(ciphertext, iv, kek); // throws if wrong passphrase
    console.log('db.unlock(): masterKey decrypted successfully.');
  }

  await saveKeyToSession(masterKey);
  setMasterKey(masterKey);
}

// lock — clear the masterKey from memory and session storage
//
// Encryption remains configured; next session will require passphrase re-entry.
export async function lock(): Promise<void> {
  await chrome.storage.session.remove('encryptionKey');
  setMasterKey(null);
  console.log('db.lock(): encryption locked.');
}

// change passphrase — re-encrypts the masterKey under a new KEK.
//
// Throws if oldPassphrase is incorrect.
export async function changePassphrase(oldPassphrase: string, newPassphrase: string): Promise<void> {
  const { encryptedMasterKey, encryptedMasterKeyIV } = await chrome.storage.local.get(
    ['encryptedMasterKey', 'encryptedMasterKeyIV']
  );
  if (!encryptedMasterKey) {
    throw new Error('changePassphrase: encryption is not configured.');
  }

  const salt = await getOrCreateSalt();

  // verify old passphrase by decrypting masterKey
  const oldKEK = await deriveKEK(oldPassphrase, salt);

  const ivArr = Object.values(encryptedMasterKeyIV as Record<string, number>);
  const ivBuf = new ArrayBuffer(ivArr.length);
  const iv = new Uint8Array(ivBuf);
  iv.set(ivArr);

  const ciphertext = new Uint8Array(Object.values(encryptedMasterKey as Record<string, number>)).buffer;

  const masterKey = await decryptMasterKey(ciphertext, iv, oldKEK); // throws if wrong

  // re-encrypt under new KEK
  const newKEK = await deriveKEK(newPassphrase, salt);
  const { ciphertext: newCiphertext, iv: newIV } = await encryptMasterKey(masterKey, newKEK);
  await chrome.storage.local.set({
    encryptedMasterKey: Array.from(new Uint8Array(newCiphertext)),
    encryptedMasterKeyIV: Array.from(newIV),
  });

  console.log('db.changePassphrase(): masterKey re-encrypted under new passphrase.');
}

export default { init, unlock, lock, changePassphrase, getEncryptionState, getMasterKey, bookmarkId, getMeta, setMeta };