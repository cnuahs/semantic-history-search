// background (service worker) script

// import { Bookmarks } from "./bookmarks";

import retriever from "./retriever";

function bin2hex(buf: ArrayBuffer) {
  const hex = Array.from(new Uint8Array(buf))
    .map((byte) => byte.toString(16).padStart(2,'0')).join('');
  return hex;
}

async function sha256(str: string) {
  const utf8 = new TextEncoder().encode(str);
  return bin2hex(await crypto.subtle.digest('SHA-256', utf8));
}

// register a content script to run on all pages
chrome.scripting.registerContentScripts([{
    id : "vhs-content-script",
    matches : [ "https://towardsdatascience.com/*", "https://medium.com/*" ], //[ "https://*/*", "http://*/*" ],
    runAt : "document_idle",
    js : [ "content.js" ],
  }])
  .then(() => console.log("Registered content script."))
  .catch((err) => console.warn("Registering content script failed:", err));

// listen for messages from the payload.js script
chrome.runtime.onMessage.addListener(function (message, _sender, sendResponse) {
  console.log("Received message from content script (%s)", message.type);

  switch (message.type) {
    case "add-bookmark":
      const info = message.payload;
      console.log("Host:", info.host);

      // del(""); console.log("Index is clear!");

      // calculate hash of .href to use as the bookmark id
      sha256(info.href)
      .then(async (hash) => {
        console.log("SHA256: %s", hash);

        // search for existing bookmark
        let bmk = (await retriever.get([hash])).filter((bmk) => bmk !== null);

        if (bmk.length === 0) {
          console.log("New bookmark:", info.href);

          retriever.add(hash, info); // add the bookmark, upsert embeddings etc.
        } else {
          console.log("Found bookmark:", info.href);

          // TODO: update the metadata (timestamp etc.)?
        }
      });

      break;

    case "del-bookmark":
      const hash = message.payload;

      console.log("Deleting bookmark:", hash);
      retriever.del(hash);

      break;

    case "search":
      const query = message.payload;

      if (query === "") {
        console.warn("Empty query string.");
        sendResponse({ type: "result", payload: [] }); // FIXME: return an empty array???
        break;
      }

      console.log("Searching for:", query);

      // const bmk: any[] = []; //await 
      retriever.search(query)
      .then((bmk) => {
        console.dir(bmk);

        sendResponse({ type: "result", payload: bmk });
      })
      .catch((err) => {
        sendResponse({ type: "error", payload: (err as Error) });
      });
      break;

    default:
      console.warn("Unknown message type:", message.type);
  };
  return true; // keep the channel open?
});

// ------------------------------

// // create a new periodic alarm
// chrome.alarms.create("vhs-embed-alarm", {
//   delayInMinutes: 0,
//   periodInMinutes: 2
// });

// // call this synchronously at startup to ensure we get woken
// // up when the alarm times out
// chrome.alarms.onAlarm.addListener(function(alarm) {
//   if (alarm.name === "vhs-embed-alarm") {
//     console.log('Alarm timed out:', new Date().toString());
//     chrome.scripting.getRegisteredContentScripts()
//       .then(scripts => console.log("registered content scripts", scripts));
//   }
// });
