// database migrations

// 2026-03-10 - Shaun L. Cloherty <s.cloherty@ieee.org>

// Migrations are run in sequence on startup via migrate().
//
// To add a new migration:
//   1. Create a new function migration_YYYYMMDD()
//   2. Add a call to it in migrate(), after all existing migrations

// eslint-disable-next-line @typescript-eslint/no-unused-vars
import PouchDB from 'pouchdb';

// 2026-03-10: migrate bookmarks from chrome.storage.local to PouchDB
async function migration_20260310(
  db: PouchDB.Database
): Promise<void> {
  const key = 'migration_20260310';
  try {
    await db.get(key);
    return; // already migrated
  } catch {
    // not migrated yet, proceed
  }

  const items = await chrome.storage.local.get('bookmarks');
  if (items['bookmarks']) {
    const bookmarks = items['bookmarks'] as Record<string, any>;
    await Promise.all(
      Object.entries(bookmarks).map(([id, bookmark]) =>
        db.upsert(id, () => ({ ...bookmark }))
      )
    );
  }

  await db.put({ _id: key });
  await chrome.storage.local.remove('bookmarks');
  console.log('Migration 20260310 complete.');
}

// 2026-03-11: replace date and count with visits array
async function migration_20260311(
  db: PouchDB.Database
): Promise<void> {
  const key = 'migration_20260311';
  try {
    await db.get(key);
    return; // already migrated
  } catch {
    // not migrated yet, proceed
  }

  const result = await db.allDocs({ include_docs: true });
  await Promise.all(
    result.rows
      .filter((row) => !row.id.startsWith('migration_') && !row.id.startsWith('meta'))
      .map((row) => {
        const doc = row.doc as any;
        if (doc.metadata) {
          // approximate visit history by replicating the .date entry
          const count = doc.metadata.count ?? 1;
          const date = doc.metadata.date ?? Date.now();
          doc.metadata.visits = Array(count).fill(date);
          delete doc.metadata.count;
          delete doc.metadata.date;
        }
        return db.upsert(row.id, () => doc);
      })
  );

  await db.put({ _id: key });
  console.log('Migration 20260311 complete.');
}

// 2026-03-15: add nrVectors to existing bookmarks (null = unknown; backfilled later)
async function migration_20260315(
  db: PouchDB.Database
): Promise<void> {
  const key = 'migration_20260315';
  try {
    await db.get(key);
    return; // already migrated
  } catch {
    // not migrated yet, proceed
  }

  const result = await db.allDocs({ include_docs: true });
  await Promise.all(
    result.rows
      .filter((row) => !row.id.startsWith('migration_') && !row.id.startsWith('meta'))
      .map((row) => {
        return db.upsert(row.id, (existing: any) => ({
          ...existing,
          metadata: {
            ...existing.metadata,
            nrVectors: null,
          },
        }));
      })
  );

  await db.put({ _id: key });
  console.log('Migration 20260315 complete.');
}

// 2026-03-17: initialise normalizeDate in meta document for URL normalisation migration
//
// note: normalizeData is only set if there are existing bookmarks — new users skip the migration entirely.
async function migration_20260317(db: PouchDB.Database): Promise<void> {
  const key = 'migration_20260317';
  try {
    await db.get(key);
    return; // already migrated
  } catch {
    // not migrated yet, proceed
  }

  const result = await db.allDocs({ include_docs: true });
  const bookmarks = result.rows.filter(
    (row) => !row.id.startsWith('migration_') && !row.id.startsWith('meta')
  );

  if (bookmarks.length > 0) {
    await db.upsert('meta', (existing: any) => ({
      ...existing,
      normalizeDate: 0, // 0 = Midnight, 1st Jan., 1970 - ensures all bookmarks get migrated (including any without a date)
    }));
    console.log('Migration 20260317: normalizeDate set to', new Date(0).toISOString());
  } else {
    console.log('Migration 20260317: no bookmarks found, skipping.');
  }

  await db.put({ _id: key });
}

// 2026-03-21: set indexed field based on nrVectors
async function migration_20260321(db: PouchDB.Database): Promise<void> {
  const key = 'migration_20260321';
  try {
    await db.get(key);
    return; // already migrated
  } catch {
    // not migrated yet, proceed
  }

  const result = await db.allDocs({ include_docs: true });
  await Promise.all(
    result.rows
      .filter((row) => !row.id.startsWith('migration_') && !row.id.startsWith('meta'))
      .map((row) => {
        return db.upsert(row.id, (existing: any) => ({
          ...existing,
          metadata: {
            ...existing.metadata,
            // != null catches both null and undefined (nrVectors may be absent pre-migration)
            indexed: existing.metadata?.nrVectors != null && existing.metadata?.nrVectors > 1,
          },
        }));
      })
  );

  await db.put({ _id: key });
  console.log('Migration 20260321 complete.');
}

// Add migrations here, e.g.:
// YYYY-MM-DD: <description>
// async function migration_YYYYMMDD(db: PouchDB.Database): Promise<void> { ... }

export async function migrate(db: PouchDB.Database): Promise<void> {
  await migration_20260310(db);
  await migration_20260311(db);
  await migration_20260315(db);
  await migration_20260317(db);
  await migration_20260321(db);
  await db.compact();
  console.log('Database compacted.');
}
