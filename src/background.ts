// background (service worker) script

// 2024-11-03 - Shaun L. Cloherty <s.cloherty@ieee.org>

import settings from "./settings";

import retriever, { Bookmark } from "./retriever";

function bin2hex(buf: ArrayBuffer) {
  const hex = Array.from(new Uint8Array(buf))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return hex;
}

async function sha256(str: string) {
  const utf8 = new TextEncoder().encode(str);
  return bin2hex(await crypto.subtle.digest("SHA-256", utf8));
}

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
              ? includes.value
              : [includes.value]
            : ["http://localhost/*"], // must specify atleast one match pattern
          excludeMatches: excludes
            ? Array.isArray(excludes.value)
              ? excludes.value
              : [excludes.value]
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

            const includes = changes.newValue["include-patterns"];
            const excludes = changes.newValue["exclude-patterns"];

            // update the content script
            updateContentScript([
              {
                id: "shs-content-script",
                matches: includes
                  ? Array.isArray(includes.value)
                    ? includes.value
                    : [includes.value]
                  : ["http://localhost/*"], // must specify atleast one match pattern
                excludeMatches: excludes
                  ? Array.isArray(excludes.value)
                    ? excludes.value
                    : [excludes.value]
                  : [],
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
chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  console.log("Received message from content script (%s)", message.type);

  switch (message.type) {
    case "add-bookmark":
      const info = message.payload;
      console.log("Host:", info.host);

      // del(""); console.log("Index is clear!");

      // calculate hash of .href to use as the bookmark id
      sha256(info.href).then(async (hash) => {
        console.log("SHA256: %s", hash);

        // search for existing bookmark
        // let bmk = (await retriever.get([hash])).filter((bmk) => bmk !== null)[0];
        let bmk = (await retriever.get([hash]))[0];

        if (bmk) {
          console.log("Found bookmark:", bmk.href);

          // TODO: update the metadata (timestamp etc.)?
          retriever.update(hash, { count: (bmk.count += 1) });

          return;
        }

        console.log("New bookmark:", info.href);

        retriever.add(hash, info); // add the bookmark, upsert embeddings etc.
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
          .get()
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

    case "dump-history":
      console.log("Dumping history.");
      retriever
        .toJSON()
        .then((json) => {
          sendResponse({ type: "history", payload: json });
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

// // create a new periodic alarm
// chrome.alarms.create("shs-alarm", {
//   delayInMinutes: 0,
//   periodInMinutes: 2
// });

// // call this synchronously at startup to ensure we get woken
// // up when the alarm times out
// chrome.alarms.onAlarm.addListener(function(alarm) {
//   if (alarm.name === "shs-alarm") {
//     console.log('Alarm timed out:', new Date().toString());
//     chrome.scripting.getRegisteredContentScripts()
//       .then(scripts => console.log("registered content scripts", scripts));
//   }
// });
