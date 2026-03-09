// database instance for bookmark persistance

// 2026-03-10 - Shaun L. Cloherty <s.cloherty@ieee.org>

import PouchDB from 'pouchdb';
import pouchdbUpsert from 'pouchdb-upsert';
PouchDB.plugin(pouchdbUpsert);

export const db = new PouchDB('shs-bookmarks');
