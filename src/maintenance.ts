// background maintenance tasks

// 2026-03-16 - Shaun L. Cloherty <s.cloherty@ieee.org>

import retriever from "./retriever";
import { normalize } from "./utils/url";
import { sha256 } from "./utils/hash";
import { getMeta, setMeta } from "./db";

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

// normalise URLs for existing bookmarks, using normalizeDate as a watermark
// returns number of bookmarks processed (0 = complete)
async function normalizeUrls(): Promise<number> {
  const meta = await getMeta();

  if (!('normalizeDate' in meta)) {
    return 0; // no work to do
  }

  const normalizeDate = meta['normalizeDate'] as number;

  const allBookmarks = await retriever.select(() => true);
  const batch = allBookmarks
    .filter(b => (b.visits[0] ?? 0) > normalizeDate)
    .sort((a, b) => (a.visits[0] ?? 0) - (b.visits[0] ?? 0))
    .slice(0, BATCH_SIZE);

  if (batch.length === 0) {
    // all bookmarks processed, remove normalizeDate from meta
    await setMeta({ normalizeDate: undefined });
    console.log('URL normalisation complete.');
    return 0;
  }

  let renamedCount = 0;
  for (const bmk of batch) {
    const normHref = normalize(bmk.href);
    const [normHash, rawHash] = await Promise.all([
      sha256(normHref),
      sha256(bmk.href),
    ]);

    if (normHash !== rawHash) {
      console.log(`Normalising bookmark: ${bmk.href} -> ${normHref}`);

      const bmk_ = (await retriever.select(b => b.id === normHash, 1))[0];

      if (bmk_) {
        console.log(`Merging ${rawHash} into ${normHash}`);
        const visits = [ ...bmk.visits, ...bmk_.visits ].sort((a, b) => a - b);
        await retriever.update(normHash, { visits: visits });
        await retriever.del(rawHash);
      } else {
        console.log(`Renaming ${rawHash} to ${normHash}`)
        await retriever.rename(rawHash, normHash);
        await retriever.update(normHash, { href: normHref });
      }
      renamedCount++;
    }
  }

  // advance watermark to visits[0] of last processed bookmark
  const lastVisit = batch[batch.length - 1].visits[0] ?? 0;
  await setMeta({ normalizeDate: lastVisit });
  console.log(`normalizeUrls: processed ${batch.length} bookmarks, ${renamedCount} renamed, watermark: ${new Date(lastVisit).toISOString()}`);

  return batch.length;
}

function schedule(delay: number = ALARM_INTERVAL_MINUTES): void {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: delay,
  });
}

// run maintenance tasks, reschedule alarm if there is more work to do
async function run(): Promise<void> {
  const normalized = await normalizeUrls();
  const updated = await reconcileVectorCounts();

  if (normalized > 0 || updated > 0) {
    schedule();
  } else {
    console.log("Maintenance complete, no more work to do.");
    chrome.alarms.clear(ALARM_NAME);
  }
}

// initialise maintenance on startup — schedule if there is work to do
async function init(): Promise<void> {
  await retriever.ready();

  const meta = await getMeta();
  const nullBookmarks = await retriever.select((bmk) => bmk.nrVectors === null, 1);

  if ('normalizeDate' in meta || nullBookmarks.length > 0) {
    console.log("Scheduling maintenance.");
    schedule();
  } else {
    console.log("No maintenance required.");
  }
}

export default { init, run, schedule };
