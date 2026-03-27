#!/usr/bin/env python3

# 2026-03-10 - Shaun L. Cloherty <s.cloherty@ieee.org>
# 2026-03-26 - Refactored to use subcommands; added sanitize subcommand.

import os, sys, json
import argparse

from pathlib import Path

from dotenv import load_dotenv
from concurrent.futures import ThreadPoolExecutor, as_completed

from pinecone import Pinecone

load_dotenv(Path(__file__).parent / ".env")

FETCH_BATCH_SIZE  = 10   # small to avoid 414 URI Too Large errors
FETCH_WORKERS     = 10   # parallel fetch threads
UPSERT_BATCH_SIZE = 200  # large[r] since upsert uses POST
DELETE_BATCH_SIZE = 1000 # Pinecone max delete batch size


def get_index():
    pc = Pinecone(api_key=os.getenv("PINECONE_API_KEY"))
    return pc.Index(os.getenv("PINECONE_INDEX_NAME"))


def chunked(lst, size):
    for i in range(0, len(lst), size):
        yield lst[i:i + size]


def fetch_batch(index, ids, namespace):
    return index.fetch(ids=ids, namespace=namespace).vectors


def backup(index, namespace, output_file):
    # --- Collect all IDs ---
    all_ids = []
    for id_batch in index.list(namespace=namespace):
        all_ids.extend(id_batch)
    print(f"Found {len(all_ids)} vectors. Fetching...", file=sys.stderr)

    # --- Parallel fetch ---
    batches = list(chunked(all_ids, FETCH_BATCH_SIZE))
    all_vectors = {}
    failed_batches = []

    with ThreadPoolExecutor(max_workers=FETCH_WORKERS) as executor:
        futures = {executor.submit(fetch_batch, index, batch, namespace): batch for batch in batches}
        for future in as_completed(futures):
            batch = futures[future]
            try:
                all_vectors.update(future.result())
                print(f"Fetched {len(all_vectors)}/{len(all_ids)} vectors...", file=sys.stderr)
            except Exception as e:
                print(f"Batch failed, will retry: {e}", file=sys.stderr)
                failed_batches.append(batch)

    # --- Retry failed batches one ID at a time ---
    if failed_batches:
        failed_ids = [id for batch in failed_batches for id in batch]
        print(f"Retrying {len(failed_ids)} failed vectors one at a time...", file=sys.stderr)
        still_failed = []
        for id in failed_ids:
            try:
                all_vectors.update(fetch_batch(index, [id], namespace))
            except Exception as e:
                print(f"Vector {id} permanently failed: {e}", file=sys.stderr)
                still_failed.append(id)

        if still_failed:
            print(f"WARNING: {len(still_failed)} vectors could not be retrieved:", file=sys.stderr)
            for id in still_failed:
                print(f"  {id}", file=sys.stderr)

    print(f"Backed up {len(all_vectors)}/{len(all_ids)} vectors.", file=sys.stderr)

    # --- Serialise ---
    serializable = {
        id: {
            "values": vec.values,
            "metadata": vec.metadata or {},
            **({"sparse_values": vec.sparse_values} if vec.sparse_values else {}),
        }
        for id, vec in all_vectors.items()
    }

    if output_file:
        with open(output_file, "w") as f:
            json.dump(serializable, f)
        print(f"Backup saved to {output_file}.", file=sys.stderr)
    else:
        json.dump(serializable, sys.stdout)


def restore(index, namespace, input_file):
    if input_file:
        with open(input_file) as f:
            data = json.load(f)
    else:
        data = json.load(sys.stdin)

    vectors_to_upsert = [
        {
            "id": id,
            "values": vec["values"],
            "metadata": vec.get("metadata", {}),
            **({"sparse_values": vec["sparse_values"]} if vec.get("sparse_values") else {}),
        }
        for id, vec in data.items()
    ]

    print(f"Restoring {len(vectors_to_upsert)} vectors...", file=sys.stderr)

    success_count = 0
    failed_batches = []

    for i, batch in enumerate(chunked(vectors_to_upsert, UPSERT_BATCH_SIZE)):
        try:
            index.upsert(vectors=batch, namespace=namespace)
            success_count += len(batch)
            print(f"Upserted batch {i+1} ({success_count}/{len(vectors_to_upsert)})", file=sys.stderr)
        except Exception as e:
            print(f"Batch {i+1} failed, will retry: {e}", file=sys.stderr)
            failed_batches.append(batch)

    # --- Retry failed batches one vector at a time ---
    if failed_batches:
        failed_vectors = [vec for batch in failed_batches for vec in batch]
        print(f"Retrying {len(failed_vectors)} failed vectors one at a time...", file=sys.stderr)
        still_failed = []
        for vec in failed_vectors:
            try:
                index.upsert(vectors=[vec], namespace=namespace)
                success_count += 1
            except Exception as e:
                print(f"Vector {vec['id']} permanently failed: {e}", file=sys.stderr)
                still_failed.append(vec["id"])

        if still_failed:
            print(f"WARNING: {len(still_failed)} vectors could not be restored:", file=sys.stderr)
            for id in still_failed:
                print(f"  {id}", file=sys.stderr)

    stats = index.describe_index_stats()
    print(f"\nDone. {success_count}/{len(vectors_to_upsert)} vectors restored.", file=sys.stderr)
    print(f"Index stats after restore: {stats}", file=sys.stderr)


def sanitize(index, namespace, dstore_file, dry_run):
    # --- Load dStore export to get the set of known bookmark IDs ---
    if dstore_file:
        with open(dstore_file) as f:
            dstore = json.load(f)
    else:
        dstore = json.load(sys.stdin)

    known_ids = set(dstore.get("bookmarks", {}).keys())
    print(f"Loaded {len(known_ids)} bookmark IDs from dStore export.", file=sys.stderr)

    # --- Page through all vector IDs in Pinecone ---
    print(f"Listing all vector IDs from Pinecone...", file=sys.stderr)
    all_ids = []
    for id_batch in index.list(namespace=namespace):
        all_ids.extend(id_batch)
    print(f"Found {len(all_ids)} vectors in Pinecone.", file=sys.stderr)

    # --- Identify orphaned vector IDs ---
    # Vector IDs are in the format "hash:uuid" — extract the hash prefix
    orphaned_ids = [id for id in all_ids if id.split(':')[0] not in known_ids]
    orphaned_hashes = set(id.split(':')[0] for id in orphaned_ids)

    print(f"Found {len(orphaned_ids)} orphaned vectors across {len(orphaned_hashes)} bookmark hashes.", file=sys.stderr)

    if not orphaned_ids:
        print("Nothing to do.", file=sys.stderr)
        return

    if dry_run:
        print(f"Dry run — would delete {len(orphaned_ids)} orphaned vectors.", file=sys.stderr)
        for hash in sorted(orphaned_hashes):
            count = sum(1 for id in orphaned_ids if id.startswith(hash))
            print(f"  {hash} ({count} vectors)", file=sys.stderr)
        return

    # --- Delete orphaned vectors in batches ---
    deleted = 0
    for batch in chunked(orphaned_ids, DELETE_BATCH_SIZE):
        try:
            index.delete(ids=batch, namespace=namespace)
            deleted += len(batch)
            print(f"Deleted {deleted}/{len(orphaned_ids)} orphaned vectors...", file=sys.stderr)
        except Exception as e:
            print(f"Delete batch failed: {e}", file=sys.stderr)

    stats = index.describe_index_stats()
    print(f"\nDone. {deleted}/{len(orphaned_ids)} orphaned vectors deleted.", file=sys.stderr)
    print(f"Index stats after sanitize: {stats}", file=sys.stderr)


def main():
    p = argparse.ArgumentParser(
        description="Manage the SHS Pinecone vector store.",
    )
    subparsers = p.add_subparsers(dest="command", required=True)

    # --- backup subcommand ---
    backup_p = subparsers.add_parser(
        "backup",
        help="Backup Pinecone index to JSON.",
    )
    backup_p.add_argument(
        "filename",
        nargs="?",
        help="JSON file to write to. Uses stdout if omitted.",
    )
    backup_p.set_defaults(cmdfn=lambda args, index, namespace: backup(index, namespace, args.filename))

    # --- restore subcommand ---
    restore_p = subparsers.add_parser(
        "restore",
        help="Restore Pinecone index from JSON.",
    )
    restore_p.add_argument(
        "filename",
        nargs="?",
        help="JSON file to read from. Uses stdin if omitted.",
    )
    restore_p.set_defaults(cmdfn=lambda args, index, namespace: restore(index, namespace, args.filename))

    # --- sanitize subcommand ---
    sanitize_p = subparsers.add_parser(
        "sanitize",
        help="Delete orphaned vectors from Pinecone using a dStore export as reference.",
    )
    sanitize_p.add_argument(
        "filename",
        nargs="?",
        help="dStore export JSON file. Uses stdin if omitted.",
    )
    sanitize_p.add_argument(
        "-n", "--dry-run",
        action="store_true",
        help="Show what would be deleted without actually deleting.",
    )
    sanitize_p.set_defaults(cmdfn=lambda args, index, namespace: sanitize(index, namespace, args.filename, args.dry_run))

    args = p.parse_args()

    namespace = os.getenv("PINECONE_NAMESPACE")
    index = get_index()

    args.cmdfn(args, index, namespace)

if __name__ == "__main__":
    main()
