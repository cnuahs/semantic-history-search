// [persistent] key-value store for settings

// 2024-11-24 - Shaun L. Cloherty <s.cloherty@ieee.org>

export type SettingValue = {
  label: string;
  description: string;
  value: string | string[] | number;
  secure: boolean;
  hidden: boolean;
};

export type Setting = SettingValue & {
  name: string;
};

// private state
const _defaults = {
  "embedding-model": {},
  "pinecone-index": {},
  "pinecone-namespace": {},
  "pinecone-api-key": {},
  "include-patterns": {},
  "exclude-patterns": {},
  "history-limit-days": {},
  "search-result-limit": {},
  "search-similarity-threshold": {},
  "search-child-limit": {},
  "search-top-k": {},
  "search-length-penalty": {},
  "indexed-half-life": {},
  "unindexed-half-life": {},
  "purge-threshold": {},
};

import { validate as _validate } from "./schemas/settings.validator"; // precompiled schema validation function

function validate(data: any): void {
  if (!_validate) {
    return;
  }

  const valid = _validate(data);
  const errors = (_validate as any).errors;

  if (valid || !errors) {
    return;
  }

  const msg = errors.map(
    ({
      instancePath,
      message = "",
    }: {
      instancePath: string;
      message?: string;
    }) => `\`${instancePath.slice(1)}\` ${message}`,
  );
  throw new Error("Settings schema violation: " + msg.join("; "));
}

validate(_defaults); // note: modifies _defaults in place

// settings migrations — run in sequence in initSettingsCache (below), before any get() or set() calls
// each migration is idempotent — safe to run multiple times

// 001: rename frecency-half-life -> indexed-half-life
function migration_001(settings: any): any {
  if (settings['frecency-half-life'] !== undefined && settings['indexed-half-life'] === undefined) {
    settings['indexed-half-life'] = { ...settings['frecency-half-life'] };
    delete settings['frecency-half-life'];
    console.log('Settings migration 001: frecency-half-life -> indexed-half-life');
  }
  return settings;
}

// add future migrations here, e.g.:
// function migration_002(settings: any): any { ... }

function migrate(settings: any): any {
  settings = migration_001(settings);
  // settings = migration_002(settings);
  return settings;
}

// helper to split a PouchDB document into { metadata, data } by separating fields starting with '_' (PouchDB metadata) from the rest (actual data)
function split(doc: any): { data: { [key: string]: any }, metadata: { [key: string]: any } } {
  const data: { [key: string]: any } = {};
  const metadata: { [key: string]: any } = {};

  Object.keys(doc).forEach(key => {
    if (key.startsWith('_')) {
      metadata[key] = doc[key];
    } else {
      data[key] = doc[key];
    }
  });

  return { data, metadata };
}

// in-memory cache of the settings document
import { db } from './db';

const settingsCache: { settings: typeof _defaults } = { settings: _defaults };

const initSettingsCache = db.get('settings')
  .then((doc: any) => {
    // run migrations before validation
    const { data: settings } = split(doc);

    const migrated = migrate(settings);
    if (migrated !== settings) {
      // migrations changed something — write back to PouchDB
      db.upsert('settings', (existing: any) => ({ ...existing, ...migrated }))
        .then(() => console.log('Settings migrated and saved.'));
    }
    Object.assign(settingsCache, { settings: migrated });
  })
  .catch(() => {
    // no settings document yet — new install, use defaults
    console.log('settings: no settings document found, using defaults.');
  });

// listen for changes to the settings document arriving via PouchDB
// (including changes arriving via CouchDB sync from another device)
db.changes({
  since: 'now',
  live: true,
  include_docs: true,
  doc_ids: ['settings'],
}).on('change', (change: any) => {
  const { data } = split(change.doc);
  const newSettings = data as typeof _defaults;
  const oldSettings = settingsCache.settings;

  settingsCache.settings = newSettings;

  // notify listeners for any changed keys
  Object.entries(newSettings).forEach(([key, obj]: [string, any]) => {
    if (oldSettings && (oldSettings as any)[key]?.value === obj?.value) {
      return;
    }
    if (callbacks[key]) {
      callbacks[key].forEach((callback) => {
        callback({ oldValue: oldSettings, newValue: newSettings });
      });
    }
  });
});

const callbacks: {
  [key: string]: ((changes: chrome.storage.StorageChange) => void)[];
} = {};

// public API
export async function get(...args: any[]): Promise<Setting | Setting[]> {
  console.log("settings.get():", args);

  if (arguments.length > 1) {
    throw new Error(
      `Too many arguments to get(). Expected 1 argument but received ${arguments.length}.`,
    );
  }

  return initSettingsCache
    .then(() => {
      const settings = JSON.parse(
        JSON.stringify(
          settingsCache.settings
            ? { ..._defaults, ...settingsCache.settings }
            : _defaults,
        ),
      );
      validate(settings);
      return settings;
    })
    .then(( settings: { [key: string]: any } ) => {
      if (arguments.length === 0 || args[0] === undefined) {
        return Object.entries(settings).map(([key, value]) => {
          value.name = key;
          return value;
        });
      }
      if (typeof args[0] === "string") {
        if (args[0] in settings) {
          let val = settings[args[0]];
          val.name = args[0];
          return val;
        }
      }
    });
}

export function set(...args: any[]): Promise<void> {
  return new Promise<void>(async (resolve, reject) => {
    if (arguments.length === 0 || args[0] === undefined) {
      reject(new Error("No arguments passed to set()."));
    }
    if (arguments.length > 2) {
      // too many arguments passed
      // return;
      reject(
        new Error(
          `Too many arguments to set(). Expected 1 or 2 arguments but received ${arguments.length}.`,
        ),
      );
    }
    if (arguments.length === 1) {
      // only one argument passed
      if (typeof args[0] === "object") {
        // .set(object)
        // set all key/value pairs from this object
        for (let o of args[0]) {
          // set the value for o.name
          await set(o.name, o.value);
        }
        resolve();
      } else {
        // unsupported arguments passed
        reject(new Error("Unsupported argument passed to set()."));
      }
    } else {
      // two arguments passed
      if (typeof args[0] === "string") {
        // first arg is a string, look at type of second arg
        if (typeof args[1] !== "undefined") {
          // .set(key, value)
          // set the value for key

          // populate settingsCache from storage.sync
          initSettingsCache
            .then(() => {
              const settings = JSON.parse(
                JSON.stringify(
                  settingsCache.settings
                    ? { ..._defaults, ...settingsCache.settings }
                    : _defaults,
                ),
              );
              validate(settings);
              return settings;
            })
            .then(( settings: { [key: string]: any }) => {
              let val = settings[args[0]];
              val.value = args[1];
              settings[args[0]] = val;
              return settings;
            })
            .then(( settings: { [key: string]: any } ) => {
              validate(settings);
              Object.assign(settingsCache.settings, settings);
              // write to PouchDB
              return db.upsert('settings', (doc: any) => ({ ...doc, ...settings }));
            })
            .then(() => {
              console.log("Settings saved to PouchDB.");
              resolve();
            })
            .catch(reject);
        } else {
          reject(new Error("No value passed to set()."));
        }
      } else {
        // unsupported arguments passed
        reject(new Error("Unsupported arguments passed to set()."));
      }
    }
  });
  // FIXME: better to raise an error than to fail silently...?
}

export function addListener(
  name: string | string[],
  callback: (changes: chrome.storage.StorageChange) => void,
): void {
  if (!Array.isArray(name)) {
    name = [name];
  }

  name.forEach((n) => {
    if (!callbacks[n]) {
      callbacks[n] = [];
    }
    callbacks[n].push(callback);
  });
}

export default { get, set, addListener };
