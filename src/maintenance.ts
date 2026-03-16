// background maintenance tasks

// 2026-03-16 - Shaun L. Cloherty <s.cloherty@ieee.org>

import retriever from "./retriever";

const ALARM_NAME = "shs-maintenance";
const BATCH_SIZE = 10;
const ALARM_INTERVAL_MINUTES = 1;

// reconcile nrVectors for bookmarks where nrVectors === null
// returns the number of bookmarks updated (0 = backfill complete)
async function reconcileVectorCounts(): Promise<number> {
  const bmks = await retriever.select(
    (bmk) => bmk.nrVectors === null,
    BATCH_SIZE,
  );

  if (bmks.length === 0) {
    return 0;
  }

  console.log(`Reconciling vector counts for ${bmks.length} bookmarks.`);

  await Promise.all(
    bmks.map(async (bmk) => {
      const count = await retriever.getNrVectors(bmk.id!);
      await retriever.update(bmk.id!, { nrVectors: count });
      console.log(`Reconciled ${bmk.id}: nrVectors = ${count}`);
    })
  );

  return bmks.length;
}

function schedule(delay: number = ALARM_INTERVAL_MINUTES): void {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: delay,
  });
}

// run maintenance tasks, reschedule alarm if there is more work to do
async function run(): Promise<void> {
  const updated = await reconcileVectorCounts();

  if (updated > 0) {
    schedule();
  } else {
    console.log("Maintenance complete, no more work to do.");
    chrome.alarms.clear(ALARM_NAME);
  }
}

// initialise maintenance on startup — schedule if there is work to do
async function init(): Promise<void> {
  await retriever.ready();
  const bmks = await retriever.select((bmk) => bmk.nrVectors === null, 1);
  if (bmks.length > 0) {
    console.log("Scheduling maintenance: bookmarks with null nrVectors found.");
    schedule();
  } else {
    console.log("No maintenance required.");
  }
}

export default { init, run, schedule };
