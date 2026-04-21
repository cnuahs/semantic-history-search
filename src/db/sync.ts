// CouchDB sync lifecycle — alarm-driven one-shot sync with AES-GCM document encryption

// 2026-04-09 - Shaun L. Cloherty <s.cloherty@ieee.org>

import PouchDB from 'pouchdb';
import transform from 'transform-pouch';

PouchDB.plugin(transform);

import { db } from './index';
import { encryptDoc, decryptDoc } from './crypto';

import settings from '../settings';

export type SyncStatus = {
  state: 'syncing' | 'ok' | 'error' | 'stopped';
  error?: string;
  lastSynced?: number; // unix timestamp (ms)
};

const ALARM_NAME = 'shs-sync';
const DEFAULT_INTERVAL_MINUTES = 5;

let _remoteDb: PouchDB.Database | null = null;

let _status: SyncStatus = { state: 'stopped' };
let _listeners: ((status: SyncStatus) => void)[] = [];

function notify(status: SyncStatus): void {
  _status = status;
  _listeners.forEach(l => l(status));
  updateBadge(status);
}

function updateBadge(status: SyncStatus): void {
  switch (status.state) {
    case 'syncing':
      chrome.action.setBadgeText({ text: '↻' });
      chrome.action.setBadgeTextColor({ color: '#ffffff'}); // white 
      chrome.action.setBadgeBackgroundColor({ color: '#0ea5e9' }); // sky-500
      break;
    case 'error':
      chrome.action.setBadgeText({ text: '!' });
      chrome.action.setBadgeTextColor({ color: '#ffffff'}); // white 
      chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // red-500
      break;
    case 'ok':
    case 'stopped':
      chrome.action.setBadgeText({ text: '' });
      break;
  }
}

async function getSyncInterval(): Promise<number> {
  const syncInterval = await settings.get('sync-interval');
  return Number(Array.isArray(syncInterval) ? syncInterval[0]?.value : syncInterval?.value) || DEFAULT_INTERVAL_MINUTES;
}

export function getStatus(): SyncStatus {
  return _status;
}

// return an "unsubscribe" function
export function addStatusListener(listener: (status: SyncStatus) => void): () => void {
  _listeners.push(listener);
  return () => { _listeners = _listeners.filter(l => l !== listener); };
}

export async function startSync(
  encryptionKey: CryptoKey,
  couchdbUrl: string,
): Promise<void> {
  // drop any existing instances
  if (_remoteDb) {
    await _remoteDb.close();
    _remoteDb = null;
  }

  // create a new instance pointing at the remote CouchDB, and apply encryption transforms
  // 
  // note: the main db instance used by the application remains untouched (plaintext)
  _remoteDb = new PouchDB(couchdbUrl);  
  (_remoteDb as any).transform({
    incoming: async (doc: Record<string, any>) => encryptDoc(doc, encryptionKey),
    outgoing: async (doc: Record<string, any>) => decryptDoc(doc, encryptionKey),
  });

  const syncInterval = await getSyncInterval();

  // cancel any existing alarm before creating a new one
  await chrome.alarms.clear(ALARM_NAME);

  // register the recurring sync alarm
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: syncInterval,
    periodInMinutes: syncInterval,
  });

  console.log(`sync.startSync(): sync alarm registered (every ${syncInterval} minutes).`);

  // run immediately so the user gets immediate feedback
  await run();
}

export async function stopSync(): Promise<void> {
  await chrome.alarms.clear(ALARM_NAME);

  // close the remote db connection (doesn't affect the local IndexedDB)
  if (_remoteDb) {
    await _remoteDb.close();
    _remoteDb = null;
  }

  notify({ state: 'stopped' });
  console.log('sync.stopSync(): sync alarm cancelled.');
}

// run a single one-shot sync cycle — called from the alarm handler in background.ts
export async function run(): Promise<void> {
  if (!_remoteDb) {
    console.warn('sync.run(): called but sync is not configured — skipping.');
    return;
  }

  notify({ state: 'syncing', lastSynced: _status.lastSynced });

  try {
    await PouchDB.sync(db, _remoteDb);

    const lastSynced = Date.now();
    await chrome.storage.local.set({ lastSynced });

    notify({ state: 'ok', lastSynced });
    console.log('sync.run(): sync completed successfully.');
  } catch (err: any) {
    const error = err?.message ?? String(err);
    console.error('sync.run(): sync failed:', error);
    notify({ state: 'error', error, lastSynced: _status.lastSynced });
  }
}

export default { startSync, stopSync, run, getStatus, addStatusListener };
