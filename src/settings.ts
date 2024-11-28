// [persistent] key-value store for settings

// 2024-11-24 - Shaun L. Cloherty <s.cloherty@ieee.org>

export type Setting = {
    name: string;
    label: string;
    description: string;
    value: string;
    secure: boolean;
};

// private state
const _defaults = {
    "embedding-model": {
    },
    "pinecone-index": {
    },
    "pinecone-namespace": {
    },
    "pinecone-api-key": {
    }
};

import { validate as _validate } from './schemas/settings.validator'; // precompiled schema validation function

function validate(data: any): void {
    if (!_validate) {
        return;
    }

    const valid = _validate(data);
    const errors = (_validate as any).errors;

    if (valid || !errors) {
        return;
    }

    const msg = errors.map(({instancePath, message = ''}: {instancePath: string, message?: string}) => `\`${instancePath.slice(1)}\` ${message}`);
    throw new Error('Settings schema violation: ' + msg.join('; '));
}

validate(_defaults); // note: modifies _defaults in place

const syncCache = { settings: _defaults };
const initSyncCache = chrome.storage.sync.get().then((items) => {
    // copy all items to syncCache
    Object.assign(syncCache, items);
});

// public API
export async function get(...args: any[]): Promise<Setting | Setting[]> {
    console.log("settings.get():", args);
    
    if (arguments.length > 1) {
        // too many arguments passed
        throw new Error(`Too many arguments to get(). Expected 1 argument but received ${arguments.length}.`);
    }

    // populate storageCache from storage.local
    return initSyncCache.then(() => {
        // nasty hack here to get a *copy* of the settings object
        const settings = JSON.parse(JSON.stringify(syncCache.settings ? { ..._defaults, ...syncCache.settings } : _defaults));
        validate(settings);
        return settings
    })
    .then((settings: { [key: string]: any }) => {
        if (arguments.length === 0 || args[0] === undefined) {
            // .get()
            return Object.entries(settings).map(([key, value]) => {value.name = key; return value});
        }
        if (typeof args[0] === "string") {
            // .get("key")
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
        // return;
        reject(new Error("No arguments passed to set()."));
    }
    if (arguments.length > 2) {
        // too many arguments passed
        // return;
        reject(new Error(`Too many arguments to set(). Expected 1 or 2 arguments but received ${arguments.length}.`));
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

                // populate syncCache from storage.sync
                initSyncCache.then(() => {
                    const settings = JSON.parse(JSON.stringify(syncCache.settings ? { ..._defaults, ...syncCache.settings } : _defaults));
                    validate(settings);
                    return settings
                })
                .then((settings: { [key: string]: any }) => {
                    // update syncCache
                    let val = settings[args[0]];
                    val.value = args[1];
                    settings[args[0]] = val;
                    return settings
                })
                .then((settings: { [key: string]: any}) => {
                    // update storage.sync
                    validate(settings);
                    Object.assign(syncCache.settings, settings);
                    chrome.storage.sync.set(syncCache, () => {
                        console.log("Settings saved to storage.sync:", syncCache);
                    });
                    resolve();
                });
            
            } else {
                // .set(key)
                // retrieve the value for key?
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

export default { get, set };
