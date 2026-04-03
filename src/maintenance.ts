// background maintenance tasks

// 2026-03-16 - Shaun L. Cloherty <s.cloherty@ieee.org>

import retriever from "./retriever";
import { normalize } from "./utils/url";
import { sha256 } from "./utils/hash";
import { getMeta, setMeta, getMasterKey } from "./db";
import { hmacId } from "./utils/id";

const ALARM_NAME = "shs-maintenance";
const BATCH_SIZE = 10;
const ALARM_INTERVAL_MINUTES = 1;

// reconcile nrVectors for bookmarks where nrVectors === null
// returns the number of bookmarks updated (0 = backfill complete)
async function reconcileVectorCounts(): Promise<number> {
  const bmks = await retriever.select(
    (bmk) => bmk.nrVectors === null || (!bmk.indexed && bmk.nrVectors !== 0),
    BATCH_SIZE,
  );

  if (bmks.length === 0) {
    return 0;
  }

  console.log(`Reconciling vector counts for ${bmks.length} bookmarks.`);

  await Promise.all(
    bmks.map(async (bmk) => {
      const count = await retriever.getNrVectors(bmk.id!);
      if (!bmk.indexed && count > 0) {
        // non-indexed bookmark with residual vectors — clean up Pinecone
        await retriever.del(bmk.id!, { vectorsOnly: true });
        console.log(`Cleaned up non-indexed bookmark ${bmk.id}: deleted ${count} vectors`);
      } else {
        await retriever.update(bmk.id!, { nrVectors: count, indexed: count > 1 });
        console.log(`Reconciled ${bmk.id}: nrVectors = ${count}, indexed = ${count > 1}`);
      }
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

// migrate existing bookmarks from SHA-256 IDs to HMAC-SHA256 IDs, using
// hmacMigrateDate as a watermark (same pattern as normalizeUrls() above)
// returns number of bookmarks processed (0 = complete)
async function hmacMigration(): Promise<number> {
  const meta = await getMeta();

  if (!('hmacMigrateDate' in meta)) {
    return 0; // no work to do
  }

  const masterKey = getMasterKey();
  if (!masterKey) {
    console.warn('hmacMigration: no masterKey available, skipping.');
    return 0;
  }

  const hmacMigrateDate = meta['hmacMigrateDate'] as number;

  const allBookmarks = await retriever.select(() => true);
  const batch = allBookmarks
    .filter(b => (b.visits[0] ?? 0) > hmacMigrateDate)
    .sort((a, b) => (a.visits[0] ?? 0) - (b.visits[0] ?? 0))
    .slice(0, BATCH_SIZE);

  if (batch.length === 0) {
    // all bookmarks processed — remove hmacMigrateDate from meta
    await setMeta({ hmacMigrateDate: undefined });
    console.log('HMAC migration complete.');
    return 0;
  }

  let renamedCount = 0;
  for (const bmk of batch) {
    const oldId = bmk.id!;
    const newId = await hmacId(masterKey, bmk.href);

    if (newId === oldId) {
      // already an HMAC ID — skip
      continue;
    }

    const existing = (await retriever.select(b => b.id === newId, 1))[0];
    if (existing) {
      // HMAC ID already exists — merge visits and delete old bookmark
      console.log(`hmacMigration: merging ${oldId} into ${newId}`);
      const visits = [...bmk.visits, ...existing.visits].sort((a, b) => a - b);
      await retriever.update(newId, { visits });
      await retriever.del(oldId);
    } else {
      // rename bookmark from SHA-256 ID to HMAC ID
      console.log(`hmacMigration: renaming ${oldId} -> ${newId}`);
      await retriever.rename(oldId, newId);
    }
    renamedCount++;
  }

  // advance watermark to visits[0] of last processed bookmark
  const lastVisit = batch[batch.length - 1].visits[0] ?? 0;
  await setMeta({ hmacMigrateDate: lastVisit });
  console.log(`hmacMigration: processed ${batch.length} bookmarks, ${renamedCount} renamed, watermark: ${new Date(lastVisit).toISOString()}`);

  return batch.length;
}

function schedule(delay: number = ALARM_INTERVAL_MINUTES): void {
  chrome.alarms.create(ALARM_NAME, {
    delayInMinutes: delay,
  });
}

// run maintenance tasks, reschedule alarm if there is more work to do
async function run(): Promise<void> {
  const migrated = await hmacMigration();
  const normalized = await normalizeUrls();
  const updated = await reconcileVectorCounts();

  if (migrated > 0 || normalized > 0 || updated > 0) {
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

  if ('hmacMigrateDate' in meta || 'normalizeDate' in meta || nullBookmarks.length > 0) {
    console.log("Scheduling maintenance.");
    schedule();
  } else {
    console.log("No maintenance required.");
  }
}

export default { init, run, schedule };
