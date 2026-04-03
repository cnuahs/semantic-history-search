// background (service worker) script

// 2024-11-03 - Shaun L. Cloherty <s.cloherty@ieee.org>

import settings, { SettingValue } from "./settings";

import retriever, { Bookmark } from "./retriever";

import db, { getMeta, setMeta } from "./db";

import { normalize } from "./utils/url";
import { sha256 } from "./utils/hash";
import { bookmarkId } from "./db";

// track tabs opened by us for refreshing
// 
// used to distinguish refress requests from normal add-bookmark
// requests in the message handler
const refreshing = new Map<number, { resolve: () => void, reject: (err: Error) => void }>();

settings
  .get() // returns *all* settings
  .then((_settings) => {
    if (!Array.isArray(_settings)) {
      _settings = [_settings];
    }

    const includes = _settings.find(
      (setting) => setting.name === "include-patterns",
    );
    const excludes = _settings.find(
      (setting) => setting.name === "exclude-patterns",
    );

    // register a content script to run on page load (actually, at document_idle)
    chrome.scripting
      .registerContentScripts([
        {
          id: "shs-content-script",
          matches: includes
            ? Array.isArray(includes.value)
              ? includes.value as string[]
              : [includes.value as string]
            : ["http://localhost/*"], // must specify atleast one match pattern
          excludeMatches: excludes
            ? Array.isArray(excludes.value)
              ? excludes.value as string[]
              : [excludes.value as string]
            : [],
          runAt: "document_idle",
          js: ["content.js"],
        },
      ])
      .then(() => {
        console.log("Registered content script.");

        // listen for changes to settings that affect the content script
        return settings.addListener(
          ["include-patterns", "exclude-patterns"],
          (changes) => {
            console.log("Settings changed:", changes);

            const newValue = changes.newValue as Record<string, SettingValue>;
            var includes = newValue["include-patterns"].value;
            var excludes = newValue["exclude-patterns"].value;

            includes = Array.isArray(includes)
              ? includes.filter((pattern): pattern is string => typeof pattern === "string")
              : typeof includes === "string"
                ? [includes]
                : ["http://localhost/*"];

            excludes = Array.isArray(excludes)
              ? excludes.filter((pattern): pattern is string => typeof pattern === "string")
              : typeof excludes === "string"
                ? [excludes]
                : [];

            // update the content script
            updateContentScript([
              {
                id: "shs-content-script",
                matches: includes, // must specify atleast one match pattern
                excludeMatches: excludes,
                css: [],
              },
            ]);
          },
        );
      })
      .catch((err) => console.warn("Registering content script failed:", err));
  })
  .catch((err) => console.error("Error:", err));

function updateContentScript(
  scripts: chrome.scripting.RegisteredContentScript[],
) {
  chrome.scripting
    .updateContentScripts(scripts)
    .then(() => console.log("Updated content script."))
    .catch((err) => console.warn("Updating content script failed:", err));
}

// listen for messages from the payload.js script
chrome.runtime.onMessage.addListener( function (message, sender, sendResponse) {
  console.log("Received message from content script (%s)", message.type);

  switch (message.type) {
    case "add-bookmark":
      const info = message.payload;
      console.log("href:", info.href);

      const force = sender.tab?.id !== undefined && refreshing.has(sender.tab.id); // force embedding/upserting

      // drop non-200 responses entirely
      if (info.status !== 200) {
        console.log("Dropping non-200 page (status %d): %s", info.status, info.href);
        if (force) {
          // preserve existing bookmark intact — a non-200 on refresh is not an error
          const p = sender.tab?.id !== undefined ? refreshing.get(sender.tab.id) : undefined;
          if (p) p.reject(new Error(`Page load failed: page returned HTTP ${info.status}`));
        }
        return false;
      }

      // calculate hash of .href to use as the bookmark id
      Promise.all([
        bookmarkId(info.href), // normalizes href and applies active hashing scheme (SHA-256 or HMAC-SHA256)
        sha256(normalize(info.href)), // legacy normalised hash... matches bookmarks created before HMAC was implemented
        sha256(info.href), // legacy un-normalized (raw) hash...  matches bookmarks created before normalization was implemented
      ]).then(async ([id, normHash, rawHash]) => {
        console.log("id:", id);

        if (force) {
          // refresh path
          
          // 200 but non-readerable — preserve bookmark intact
          if (!info.text) {
            const p = refreshing.get(sender.tab!.id!);
            if (p) p.resolve(); // not an error, just no new/usable information... nothing to update
            return;
          }
          
          // update metadata, embed, upsert (preserve visits etc.)
          let bmk = (await retriever.select(b => b.id === id, 1))[0] as Bookmark;
          if (!bmk && normHash !== id) {
            // look for the bookmark under normalised SHA-256 (pre-HMAC)
            bmk = (await retriever.select(b => b.id === normHash, 1))[0] as Bookmark;
          }
          if (!bmk && rawHash !== normHash) {
            // look for the bookmark under raw SHA-256 (pre-normalisation)
            bmk = (await retriever.select(b => b.id === rawHash, 1))[0] as Bookmark;
          }
          if (!bmk) {
            // should never end up here... this path shouldn't be taken without a bookmark to refresh
            // console.warn("Reindex: bookmark not found for:", id, normHash, rawHash);
            const p = refreshing.get(sender.tab!.id!);
            if (p) p.reject(new Error("Refresh: bookmark not found."));
            return;
          }

          if (!bmk.id) {
            // should never end up here... no bookmark should be without an id!
            // console.warn("Refresh: bookmark has no id!");
            const p = refreshing.get(sender.tab!.id!);
            if (p) p.reject(new Error("Refresh: bookmark has no id."));
            return;
          }

          try {
            // note: race condition possible here — if the maintenance task renames this
            // bookmark (rawHash -> normHash) while embedding is in progress, update() will
            // reinstate the bookmark under rawHash. The maintenance task will detect and
            // merge the duplicate on its next run, with a possible visit double-count.
          
            await retriever.update(bmk.id, {
              title: info.title,
              excerpt: info.excerpt,
              host: info.host, // should we be updating this? could it be different?
            }, { text: info.text });

            const p = sender.tab?.id !== undefined ? refreshing.get(sender.tab.id) : undefined;
            if (p) p.resolve();
          } catch (err) {
            const p = sender.tab?.id !== undefined ? refreshing.get(sender.tab.id) : undefined;
            if (p) p.reject(err instanceof Error ? err : new Error(String(err)));
          }

          return;
        }

        // normal add-bookmark path

        // check for existing bookmark under current id scheme
        let bmk = (await retriever.select(b => b.id === id, 1))[0];
        if (bmk) {
          console.log("Found bookmark:", bmk.href);
          const p = retriever.update(id, { visits: [...bmk.visits, Date.now()] });

          // attempt indexing if page was previously unreaderable but is now readerable
          if (!bmk.indexed && info.text) {
            console.log("Lazy re-index:", bmk.href);
            p.then(() => retriever.update(id, { title: info.title, excerpt: info.excerpt }, { text: info.text }));
          }

          return;
        }

        // check for existing bookmark under normalised SHA-256 (pre-HMAC legacy)
        if (normHash !== id) {
          bmk = (await retriever.select(b => b.id === normHash, 1))[0];
          if (bmk) {
            console.log("Found bookmark (pre-HMAC):", bmk.href);
            const p = retriever.update(normHash, { visits: [...bmk.visits, Date.now()] });

            // attempt indexing if page was previously unreaderable but is now readerable
            if (!bmk.indexed && info.text) {
              console.log("Lazy re-index (pre-HMAC):", bmk.href);
              p.then(() => retriever.update(normHash, { title: info.title, excerpt: info.excerpt }, { text: info.text }));
            }

            return;
          }
        }

        // check for existing bookmark under raw SHA-256 (pre-normalisation legacy)
        if (rawHash !== normHash) {
          bmk = (await retriever.select(b => b.id === rawHash, 1))[0];
          if (bmk) {
            console.log("Found bookmark (pre-normalisation):", bmk.href);
            const p = retriever.update(rawHash, { visits: [...bmk.visits, Date.now()] });

            // attempt indexing if page was previously unreaderable but is now readerable
            if (!bmk.indexed && info.text) {
              console.log("Lazy re-index (pre-normalisation):", bmk.href);
              p.then(() => retriever.update(rawHash, { title: info.title, excerpt: info.excerpt }, { text: info.text }));
            }

            return;
          }
        }

        // new bookmark
        console.log("New bookmark:", normalize(info.href));
        retriever.add(id, { ...info, href: normalize(info.href) });
      });

      return false; // close the channel

    case "del-bookmark":
      const hash = message.payload;

      console.log("Deleting bookmark:", hash);
      retriever.del(hash);

      return false; // close the channel;

    case "search":
      const query = message.payload;

      if (query === "") {
        console.warn("Empty query string.");

        // get *all* bookmarks
        retriever
          .select()
          .then((bmk) => {
            sendResponse({ type: "result", payload: bmk });
          })
          .catch((err) => {
            sendResponse({ type: "error", payload: err as Error });
          });

        break;
      }

      console.log("Searching for:", query);

      // const bmk: any[] = []; //await
      retriever
        .search(query)
        .then((bmk) => {
          console.dir(bmk);

          sendResponse({ type: "result", payload: bmk });
        })
        .catch((err) => {
          sendResponse({ type: "error", payload: err as Error });
        });

      break;

    case "refresh-bookmark": {
      // this is a request from the the popup to refresh a bookmark — we open a new tab to trigger
      // the content script, then wait for handling of the ensuing add-bookmark message to indicate
      // when it's done...
      // 
      // we need to "await" the add-bookmark handler, but making the listener itself async breaks Chrome's
      // message channel handline... the workaround is to wrap this in an async immediately invoked
      // function expression (IIFE)
      (async () => {
        const info = message.payload;
        console.log("Refreshing bookmark:", info.id);   

        const hasPermission = await chrome.permissions.contains({ permissions: ['tabs'] });
        if (!hasPermission) {
          sendResponse({ type: "error", payload: new Error("tabs permission not granted") });
          return;
        }   

        // const tab = await chrome.tabs.create({ url: info.url, active: false });
        const tab: chrome.tabs.Tab = await chrome.tabs.create({ url: info.href, active: false });
        if (!tab.id) {
          sendResponse({ type: "error", payload: new Error("Failed to create tab") });
          return;
        }   

        const tabId_ = tab.id!;

        // register resolve callback before injecting — avoids a race where
        // add-bookmark fires before the promise is registered
        const TIMEOUT_MS = 180_000; // 3 minute timeout?
        let timeout: ReturnType<typeof setTimeout>;

        const done = new Promise<void>((resolve, reject) => {
          refreshing.set(tabId_, { resolve, reject });
          timeout = setTimeout(() => {
            reject(new Error(`Refresh timed out after ${TIMEOUT_MS / 1000}s`));
          }, TIMEOUT_MS);
        });

        // wait for tab to finish loading
        await new Promise<void>((resolve) => {
          chrome.tabs.onUpdated.addListener(function listener(tabId, info) {
            if (tabId === tabId_ && info.status === 'complete') {
              chrome.tabs.onUpdated.removeListener(listener);
              resolve();
            }
          });
        });

        // inject the content script manually (tab may not match include patterns)
        // await chrome.scripting.executeScript({
        //   target: { tabId: tabId_ },
        //   files: ['content.js'],
        // });

        // the content script will send an add-bookmark message (handled above)... here
        // wait for it to be processed, then clean up
        try {
          await done;
          sendResponse({ type: "result", payload: null });
        } catch (err) {
          sendResponse({ type: "error", payload: err as Error });
        } finally {
          clearTimeout(timeout!);
          refreshing.delete(tabId_);
          await chrome.tabs.remove(tabId_);
        }
      })().catch(err => {
        sendResponse({ type: "error", payload: err as Error });
      });

      return true; // keep the channel open
    }

    case "index-stats":
      retriever
        .indexStats()
        .then((stats) => {
          sendResponse({ type: "result", payload: stats });
        })
        .catch((err) => {
          sendResponse({ type: "error", payload: err as Error });
        });

      return true; // keep the channel open

    case "get-meta":
      getMeta()
        .then((meta) => {
          sendResponse({ type: "result", payload: meta });
        })
        .catch((err) => {
          sendResponse({ type: "error", payload: err as Error });
        });

      return true; // keep the channel open

    case "set-meta":
      setMeta(message.payload)
        .then(() => {
          sendResponse({ type: "result", payload: null });
        })
        .catch((err) => {
          sendResponse({ type: "error", payload: err as Error });
        });
        
      return true; // keep the channel open

    case "get-status":
      retriever.ready().then((ready) => {
        sendResponse({ type: "result", payload: {
          setupRequired: !db.ready(),
          retrieverReady: ready,
        }});
      });

      return true; // keep the channel open

    default:
      console.warn("Unknown message type:", message.type);

      return false; // close the channel
  }

  return true; // keep the channel open?
});

import {
  addOnChunkedMessageListener,
  sendChunkedResponse,
} from "ext-send-chunked-message";

addOnChunkedMessageListener(function (
  message: any,
  _sender: any,
  sendResponse: any,
) {
  // "message" is a large message, received in chunks and reassembled

  switch (message.type) {
    case "dump-history":
      console.log("Dumping history.");
      retriever
        .toJSON()
        .then((json) => {
          sendChunkedResponse({
            sendMessageFn: (message: any) =>
              chrome.runtime.sendMessage(message),
          })({ type: "history", payload: json }, sendResponse);
        })
        .catch((err) => {
          sendResponse({ type: "error", payload: err as Error });
        });

      break;

    case "load-history":
      console.log("Loading history.");

      const json = message.payload;

      retriever.fromJSON(json).then(() => {
        console.log("Loaded!!?");
      });

      return false; // close the channel
    default:
      console.warn("Unknown message type:", message.type);

      return false; // close the channel
  }

  return true; // keep the channel open?
});

// ------------------------------

import maintenance from "./maintenance";

retriever.ready().then((ready) => {
  if (!ready) {
    console.warn('background: not ready —', db.ready() ? 'retriever failed to initialise.' : 'setup required.');
    return;
  }

  maintenance.init();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "shs-maintenance") {
    maintenance.run().catch(err => {
      console.warn("Maintenance run failed, will retry:", err.message);
      maintenance.schedule(10); // wait 10 minutes if there was an error
    });
  }
});
