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

let _masterKey: CryptoKey | null = null;

export function getMasterKey(): CryptoKey | null {
  return _masterKey;
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

// retrieve (or initialise) _masterKey on service worker startup
//
// note: must be called (and resolve?) before retriever initialisation...
export async function init(): Promise<void> {
  const { masterKey: stored } = await chrome.storage.local.get('masterKey');
  if (stored) {
    _masterKey = await crypto.subtle.importKey(
      'raw',
      new Uint8Array(Object.values(stored as Record<string, number>)),
      { name: 'HMAC', hash: 'SHA-256', length: 256 },
      true,
      ['sign'],
    );
    console.log('db.init(): masterKey loaded from storage.');
    return;
  }

  // first run — generate and store a new masterKey
  _masterKey = await crypto.subtle.generateKey(
    { name: 'HMAC', hash: 'SHA-256', length: 256 },
    true,
    ['sign'],
  );
  const raw = await crypto.subtle.exportKey('raw', _masterKey);
  await chrome.storage.local.set({ masterKey: Array.from(new Uint8Array(raw)) });
  console.log('db.init(): masterKey generated and stored.');
}

export default { init, getMasterKey, bookmarkId, getMeta, setMeta };