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
    }
  });
