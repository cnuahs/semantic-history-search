// database instance for bookmark persistance

// 2026-03-10 - Shaun L. Cloherty <s.cloherty@ieee.org>

import PouchDB from 'pouchdb';
import pouchdbUpsert from 'pouchdb-upsert';
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
