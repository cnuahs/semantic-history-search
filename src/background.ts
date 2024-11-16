// background (service worker) script

// import { Bookmarks } from "./bookmarks";

import { store, search, get, remove } from "./retriever";

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
chrome.runtime.onMessage.addListener(function (message) {
  console.log("Received message (%s)", message.host);

  // remove("");
  // console.log('Clean!');

  // calculate hash of .href to use as the bookmark id
  sha256(message.href)
  .then(async (hash) => {
    console.log("SHA256: %s", hash);

    // search for existing bookmark
    let bmk = (await get([hash])).filter((bmk) => bmk !== null);

    if (bmk.length === 0) {
      console.groupCollapsed("Adding new bookmark:", message.href);

      await store( hash, message ); // add to dStore, embed and upsert to vStore

      console.groupEnd();
    } else {
      console.log("Bookmark already exists:", message.href);
    }

    // console.log("Ok");

    // console.dir(dStore);

    // test get() based on bookmark id
    bmk = await get([hash]); // should *definitely* be in the store now
    console.dir(bmk);

    // test search() over embeddings
    bmk = await search("a page about vizualising travel stories");
    console.dir(bmk);

    bmk = await search("javascript/typescript promises");
    console.dir(bmk);

    bmk = await search("document embedding for RAG");
    console.dir(bmk);

    // test removal based on bookmark id
    // remove(hash);


    // 1. search storage.sync for the hash
    // 2.1 found --> update the metadata (timestamp etc.?) and return
    // 2.2 not found -> add the bookmark, upsert embeddings and return
    
  });
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
