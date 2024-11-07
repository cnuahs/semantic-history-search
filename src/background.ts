// background (service worker) script

// create a new periodic alarm
chrome.alarms.create("vhs-embed-alarm", {
    delayInMinutes: 0,
    periodInMinutes: 2
  });

// call this synchronously at startup to ensure we get woken
// up when the alarm times out
chrome.alarms.onAlarm.addListener(function(alarm) {
    if (alarm.name === "vhs-embed-alarm") {
      console.log('Alarm timed out:', new Date().toString());
      chrome.scripting.getRegisteredContentScripts()
        .then(scripts => console.log("registered content scripts", scripts));
    }
  });



// register a content script to run on all pages
chrome.scripting.registerContentScripts([{
    id : "vhs-content-script",
    matches : [ "https://*/*", "http://*/*" ],
    runAt : "document_idle",
    js : [ "content.js" ],
  }])
  .then(() => console.log("Registered content script."))
  .catch((err) => console.warn("Registering content script failed:", err));

// listen for messages from the payload.js script
chrome.runtime.onMessage.addListener(function (message) {
	console.log("worker:"); console.log(message.text);
});