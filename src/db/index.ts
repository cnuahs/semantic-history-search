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

import { generateMasterKey as _generateMasterKey, importMasterKey as _importMasterKey, deriveEncryptionKey } from './crypto';

let _masterKey: CryptoKey | null = null;
let _encryptionKey: CryptoKey | null = null;

// generate a new masterKey and store in chrome.storage.local
// called from migration_20260404 (existing users) and the setup wizard (new users)
export async function generateMasterKey(): Promise<void> {
  _masterKey = await _generateMasterKey();
  _encryptionKey = await deriveEncryptionKey(_masterKey);
}

// import a masterKey from a hex string (used during join existing sync setup)
export async function importMasterKey(hex: string): Promise<void> {
  _masterKey = await _importMasterKey(hex);
  _encryptionKey = await deriveEncryptionKey(_masterKey);
}

export function getMasterKey(): CryptoKey | null {
  return _masterKey;
}

export function getEncryptionKey(): CryptoKey | null {
  return _encryptionKey;
}

// retrieve _masterKey on service worker startup
//
// note: must be called (and resolve?) before retriever initialisation...
export async function init(): Promise<void> {
  const { masterKey: raw } = await chrome.storage.local.get('masterKey');
  if (!raw) {
    console.log('db.init(): no masterKey found — setup required.');
    return;
  }

  _masterKey = await crypto.subtle.importKey(
    'raw',
    new Uint8Array(Object.values(raw as Record<string, number>)),
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign'],
  );

  _encryptionKey = await deriveEncryptionKey(_masterKey);

  console.log('db.init(): masterKey loaded.');
}

export function ready(): boolean {
  return _masterKey !== null;
}

//
// bookmark IDs
//

import { sha256Id, hmacId } from '../utils/id';

// calculate bookmark ID using _masterKey
export async function bookmarkId(href: string): Promise<string> {
  if (_masterKey) {
    return hmacId(_masterKey, href);
  }
  return sha256Id(href); // fallback before init() completes
}

export default { getMeta, setMeta, generateMasterKey, importMasterKey, getMasterKey, getEncryptionKey, init, ready, bookmarkId };