// database instance for bookmark persistance

// 2026-03-10 - Shaun L. Cloherty <s.cloherty@ieee.org>

import PouchDB from 'pouchdb';
import pouchdbUpsert from 'pouchdb-upsert';

import { sha256Id, hmacId } from '../utils/id';

PouchDB.plugin(pouchdbUpsert);

export const db = new PouchDB('shs-bookmarks');

// metadata document helpers
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

// possible encryption states:
//
//   'unconfigured' — encryption/passphrase never configures, SHA-256 IDs in use,
//   'locked'       — encryption/passphrase configured but passphrase not yet entered in this session,
//   'unlocked'     — encryption/passphrase configures, and masterKey active, HMAC IDs in use.
type EncryptionState = 'unconfigured' | 'locked' | 'unlocked';

let _masterKey: CryptoKey | null = null;
let _encryptionState: EncryptionState = 'unconfigured';

export function getEncryptionState(): EncryptionState {
  return _encryptionState;
}

export function getMasterKey(): CryptoKey | null {
  return _masterKey;
}

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
