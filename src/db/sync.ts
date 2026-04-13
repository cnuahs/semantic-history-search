// CouchDB sync lifecycle

// 2026-04-09 - Shaun L. Cloherty <s.cloherty@ieee.org>

import PouchDB from 'pouchdb';
import transform from 'transform-pouch';

PouchDB.plugin(transform);

import { encryptDoc, decryptDoc } from './crypto';

export type SyncStatus = {
  state: 'active' | 'paused' | 'error' | 'stopped';
  error?: string;
  lastSynced?: number; // unix timestamp (ms)
};

let _handler: PouchDB.Replication.Sync<object> | null = null;
let _syncDb: PouchDB.Database | null = null;
let _status: SyncStatus | null = null;
let _listeners: ((status: SyncStatus) => void)[] = [];

function notify(status: SyncStatus): void {
  _status = status;
  _listeners.forEach(l => l(status));
  updateBadge(status);
}

function updateBadge(status: SyncStatus): void {
  switch (status.state) {
    case 'active':
      chrome.action.setBadgeText({ text: '↻' });
      chrome.action.setBadgeBackgroundColor({ color: '#0ea5e9' }); // sky-500
      break;
    case 'error':
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // red-500
      break;
    case 'paused':
      // healthy/up to date — clear the badge
      chrome.action.setBadgeText({ text: '' });
      break;
    case 'stopped':
      chrome.action.setBadgeText({ text: '' });
      break;
  }
}

export function getStatus(): SyncStatus | null {
  return _status;
}

// returns an unsubscribe function
export function addStatusListener(listener: (status: SyncStatus) => void): () => void {
  _listeners.push(listener);
  return () => { _listeners = _listeners.filter(l => l !== listener); };
}

export async function startSync(
  encryptionKey: CryptoKey,
  couchdbUrl: string,
): Promise<void> {
  if (_handler) {
    console.log('sync.startSync(): sync already active, stopping first.');
    await stopSync();
  }

  // create a separate PouchDB instance pointing at the same underlying IndexedDB,
  // with encryption transforms applied exclusively for the sync path —
  // the main db instance used by the application remains untouched (plaintext)
  _syncDb = new PouchDB('shs-bookmarks');
  (_syncDb as any).transform({
    incoming: async (doc: Record<string, any>) => decryptDoc(doc, encryptionKey),
    outgoing: async (doc: Record<string, any>) => encryptDoc(doc, encryptionKey),
  });

  const remoteDb = new PouchDB(couchdbUrl);

  // restore lastSynced from chrome.storage.local
  const { lastSynced } = await chrome.storage.local.get('lastSynced');

  console.log('sync.startSync(): starting live sync to', couchdbUrl);
  _handler = _syncDb.sync(remoteDb, { live: true, retry: true })
    .on('active', () => {
      console.log('sync: active');
      notify({ state: 'active', lastSynced: _status?.lastSynced });
    })
    .on('paused', (err: any) => {
      if (err) {
        // paused due to a transient error (e.g. network drop) — PouchDB will retry automatically
        console.warn('sync: paused with error:', err);
        notify({ state: 'error', error: err.message ?? String(err), lastSynced: _status?.lastSynced });
      } else {
        // paused because sync is up to date
        const lastSynced = Date.now();
        chrome.storage.local.set({ lastSynced: lastSynced });
        console.log('sync: paused (up to date)');
        notify({ state: 'paused', lastSynced });
      }
    })
    .on('error', (err: any) => {
      // permanent error — sync has stopped, user intervention required
      console.error('sync: permanent error:', err);
      notify({ state: 'error', error: err.message ?? String(err), lastSynced: _status?.lastSynced });
      _handler = null;
      _syncDb = null;
    });

  _status = { state: 'active', lastSynced: lastSynced as number ?? undefined };
}

export async function stopSync(): Promise<void> {
  if (_handler) {
    console.log('sync.stopSync(): cancelling sync handler.');
    _handler.cancel();
    _handler = null;
  }

  if (_syncDb) {
    await _syncDb.close();
    _syncDb = null;
  }

  notify({ state: 'stopped' });
  _status = null;
  console.log('sync.stopSync(): sync stopped.');
}

export function isActive(): boolean {
  return _handler !== null;
}

export default { startSync, stopSync, getStatus, addStatusListener, isActive };
