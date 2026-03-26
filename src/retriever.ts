// parent document retriever

// 2024-11-11 - Shaun L. Cloherty <s.cloherty@ieee.org>

// helper for chrome.storage.local (used to store bookmarks)

// wtf, can only serialise/resurect serializable objects in the langchain or
// langchain-core namespaces... as a workaround, for now just store the bookmarks.
// const localCache: { bookmarks: Record<string, Bookmark> } = { bookmarks: {} };
// const initLocalCache = chrome.storage.local.get().then((items) => {
//   // copy all items to localCache
//   Object.assign(localCache, items);
// });

import { db } from './db';
import { migrate } from './db/migrations';

/*
 * text splitter(s)...
 */

// import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// const splitter = new RecursiveCharacterTextSplitter({
//   chunkSize: 100,
//   chunkOverlap: 0,
//   // separators: [".", "!", "?", ";", ":", "\n"],
// });

import {
  CharacterTextSplitter,
  CharacterTextSplitterParams,
} from "@langchain/textsplitters";

/*
 * The naive text splitter splits on sentence separators
 */
interface NaiveTextSplitterParams extends CharacterTextSplitterParams {
  // add properties here
}

class NaiveTextSplitter
  extends CharacterTextSplitter
  implements NaiveTextSplitterParams
{
  static override lc_name() {
    return "NaiveTextSplitter";
  }

  constructor(fields?: Partial<NaiveTextSplitterParams>) {
    super(fields);
    this.separator = "(?:[\.\?\!])"; // sentence separators
    this.chunkSize = fields?.chunkSize ?? 3; // sentences
    this.chunkOverlap = fields?.chunkOverlap ?? 2;
    this.lengthFunction = (text: string) =>
      this.splitOnSeparator(text, this.separator).length; // length in words
  }

  protected override splitOnSeparator(
    text: string,
    separator: string,
  ): string[] {
    let splits;
    if (separator) {
      const regexEscapedSeparator = separator.replace(
        /[/\-\\^$*+?.()|[\]{}]/g,
        "\\$&",
      );

      if (this.keepSeparator) {
        const re = new RegExp(`(?=${regexEscapedSeparator})`); // look ahead?
        splits = text.split(re);
      } else {
        let re = new RegExp(`(${regexEscapedSeparator})`, "g");
        splits = text.replace(re, ".").split(".");
      }
    } else {
      splits = text.split("");
    }
    return splits.filter((s) => s !== "");
  }

  override async splitText(text: string): Promise<string[]> {
    // naive splitting... split by sentence
    const splits = this.splitOnSeparator(text, this.separator);
    return this.mergeSplits(splits, this.keepSeparator ? "" : " ");
  }

  // override joinDocs(docs: string[], separator: string): string | null {
  //   const text = docs.join(separator).trim();
  //   return text === "" ? null : text;
  // }

  override async mergeSplits(
    splits: string[],
    separator: string = " ",
  ): Promise<string[]> {
    const docs: string[] = [];
    const thisDoc: string[] = [];
    let nrSplits = 0;
    for (const split of splits) {
      if (nrSplits + 1 > this.chunkSize) {
        if (thisDoc.length > 0) {
          // const doc = this.joinDocs(thisDoc, separator);

          const doc = thisDoc.join(separator).trim();

          if (doc !== "") {
            docs.push(doc);
          }
          // drop the leading split until:
          //   - number of splits remaining exceeds .chunkOverlap, OR
          //   - appending a split would exceed .chunkSize
          while (
            nrSplits > this.chunkOverlap ||
            (nrSplits + 1 > this.chunkSize && nrSplits > 0)
          ) {
            nrSplits -= 1;
            thisDoc.shift();
          }
        }
      }
      thisDoc.push(split);
      nrSplits += 1;
    }
    // const doc = this.joinDocs(thisDoc, separator);
    const doc = thisDoc.join(separator).trim();
    if (doc !== null) {
      docs.push(doc);
    }
    return docs;
  }
}

/*
 * Embedding model...
 */

import { chunkArray } from "@langchain/core/utils/chunk_array";

import { env } from "@xenova/transformers";
env.allowLocalModels = false;
env.allowRemoteModels = true; // FIXME: make this false by default (need to bundle the model with the ext?)
env.useBrowserCache = true;

// disable multithreading in onnxruntime-web... hopefully this is a temporary fix!
// See https://github.com/huggingface/transformers.js
//     https://github.com/microsoft/onnxruntime/issues/14445
env.backends.onnx.wasm.numThreads = 1;

import { Embeddings, EmbeddingsParams } from "@langchain/core/embeddings";
import { pipeline, type FeatureExtractionPipeline } from "@xenova/transformers";

interface HuggingFaceTransformersEmbeddingsSmlMemParams
  extends EmbeddingsParams {
    model?: string;
    batchSize?: number;
}

class HuggingFaceTransformersEmbeddingsSmlMem
  extends Embeddings
  implements HuggingFaceTransformersEmbeddingsSmlMemParams
{
  model: string;
  batchSize: number;
  private pipe: FeatureExtractionPipeline | null = null;

  constructor(fields: HuggingFaceTransformersEmbeddingsSmlMemParams) {
    super(fields);
    this.model = fields.model!; // e.g., "Xenova/all-MiniLM-L6-v2" (should come from the users settings...)
    this.batchSize = fields.batchSize ?? 100;
  }

  private async getPipeline(): Promise<FeatureExtractionPipeline> {
    if (!this.pipe) {
      this.pipe = await pipeline("feature-extraction", this.model);
    }
    return this.pipe;
  }

  async embedQuery(text: string): Promise<number[]> {
    const pipe = await this.getPipeline();
    const output = await pipe(text, { pooling: "mean", normalize: true });
    return Array.from(output.data as Float32Array);
  }

  override async embedDocuments(docs: string[]): Promise<number[][]> {
    // reducing the embedding model .batchSize doesn't seem to ease memory requirements, because
    // the [HuggingFaceTransformers]Embeddings class dispatches all batches concurrently.
    //
    // here we perform our own "batching" and await each batch before moving on to the next.
    console.log("Embedding %i documents", docs.length);
    console.time("Elapsed");

    function docMetrics(docs: string[]) {
      const n = docs.map(
        (doc) => doc.replace(/[^\w\s]/g, "").split(/\s+/).length, // FIXME: naive word count... better to use the tokenizer itself
      );
      const mn = Math.min(...n);
      const mx = Math.max(...n);
      const ave = Math.round(n.reduce((a, b) => a + b, 0) / n.length);
      return [mn, ave, mx];
    }
    console.log("Document (chunk) size (min/ave/max):", docMetrics(docs));

    let embeddings: number[][] = [];

    const batches: string[][] = chunkArray(docs, this.batchSize);
    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      let embeds: number[][] = [];
      try {
        embeds = await Promise.all(batch.map((doc) => this.embedQuery(doc)));
      } catch (err) {
        console.log(
          `Embedding batch ${i + 1}/${batches.length} failed (min/ave/max): ${docMetrics(batch)}`,
        );
        console.error(err);
      }
      embeddings.push(...embeds);
      console.log("Embedded %i documents", embeddings.length);
    }
    console.log("Done embedding %i documents", embeddings.length);
    console.timeEnd("Elapsed");
    return Promise.resolve(embeddings);
  }
}

// const model = new HuggingFaceTransformersEmbeddingsSmlMem({
//   // batchSize: 128,
//   model: "Xenova/all-MiniLM-L6-v2"
// });

// import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
// const model = new HuggingFaceInferenceEmbeddings({
//   model: "sentence-transformers/all-MiniLM-L6-v2",
//   apiKey: "API_KEY"
// })

/*
 * vector store...
 */

import * as uuid from "uuid";
import { flatten } from "flat";

import {
  RecordMetadata,
  PineconeRecord,
  // Index as PineconeIndex,
  // ScoredPineconeRecord,
} from "@pinecone-database/pinecone";

import { Document } from "@langchain/core/documents";
import { PineconeStore } from "@langchain/pinecone"; // requires "experiments.topLevelAwait: true" in custom-webpack-config.ts

class PineconeStoreNoContent extends PineconeStore {
  // constructor(embeddings: EmbeddingsInterface, params: PineconeStoreParams) {
  //   super(embeddings, params);
  // }

  override async addDocuments(
    documents: Document[],
    options?: { ids?: string[]; namespace?: string } | string[],
  ): Promise<string[]> {
    // Pinecone serverless indexes do not support deleting by metadata. BUT you can delete records
    // by Id prefix. Here we assign the doc_id (from .metadata) as a prefix... Ids will be of the
    // form "doc_id:uuid", allowing us to delete by prefix using "doc_id:".
    const ids = documents.map((doc) =>
      doc.metadata && doc.metadata["doc_id"]
        ? doc.metadata["doc_id"] + ":" + uuid.v4()
        : "",
    );
    options = options ? { ...options, ids: ids } : { ids: ids };

    const texts = documents.map(({ pageContent }) => pageContent);
    return this.addVectors(
      await this.embeddings.embedDocuments(texts),
      documents,
      options,
    );
  }

  override async addVectors(
    vectors: number[][],
    documents: Document<Record<string, any>>[],
    options?: { ids?: string[]; namespace?: string } | string[],
  ) {
    console.log("Adding vectors to Pinecone");
    // const ids = options?.ids ?? documents.map(({ id }) => id);
    // const namespace = options?.namespace ?? this.namespace;
    const ids = Array.isArray(options) ? options : options?.ids;
    const documentIds = ids == null ? documents.map(() => uuid.v4()) : ids;
    const pineconeVectors = vectors.map((values, idx) => {
      // Pinecone doesn't support nested objects, so we flatten them
      const documentMetadata = { ...documents[idx].metadata };
      // preserve string arrays which are allowed
      const stringArrays: Record<string, string[]> = {};
      for (const key of Object.keys(documentMetadata)) {
        if (
          Array.isArray(documentMetadata[key]) &&
          // eslint-disable-next-line @typescript-eslint/ban-types, @typescript-eslint/no-explicit-any
          documentMetadata[key].every((el: any) => typeof el === "string")
        ) {
          stringArrays[key] = documentMetadata[key];
          delete documentMetadata[key];
        }
      }
      const metadata: {
        [key: string]: string | number | boolean | string[] | null;
      } = {
        ...flatten(documentMetadata),
        ...stringArrays,
        // [this.textKey]: documents[idx].pageContent,
      };
      // Pinecone doesn't support null values, so we remove them
      for (const key of Object.keys(metadata)) {
        if (metadata[key] == null) {
          delete metadata[key];
        } else if (
          typeof metadata[key] === "object" &&
          Object.keys(metadata[key] as unknown as object).length === 0
        ) {
          delete metadata[key];
        }
      }

      return {
        id: documentIds[idx],
        metadata,
        values,
      } as PineconeRecord<RecordMetadata>;
    });

    const optionsNamespace =
      !Array.isArray(options) && options?.namespace
        ? options.namespace
        : this.namespace;
    const namespace = this.pineconeIndex.namespace(optionsNamespace ?? "");
    // Pinecone recommends a limit of 100 vectors per upsert request
    const chunkSize = 100;
    const chunkedVectors = chunkArray(pineconeVectors, chunkSize);
    const batchRequests = chunkedVectors.map((chunk) =>
      this.caller.call(async () => namespace.upsert(chunk)),
    );

    await Promise.all(batchRequests); // FIXME: need to catch and store the max LSU for the upsert operations

    return documentIds;
  }
}

import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";

/*
 * "document" store... actually, where we'll store bookmarks
 */

// import { InMemoryStore } from "@langchain/core/stores"
import { BaseStore } from "@langchain/core/stores";

export interface DocStoreWithUpdate {
  update(key: string, fields: Record<string, any>): Promise<void>;
}

// In-memory store using a dictionary, backed by IndexedDB (via PouchDB).
export class InMemoryLocalStore extends BaseStore<string, Document> implements DocStoreWithUpdate {
  override lc_namespace = [".", "retriever"];
  override lc_serializable = true;

  store: Record<string, Bookmark> = {}; // serializable?

  // add .store to the list of attributes to be serialised
  override get lc_attributes(): string[] {
    return ["store"];
  }

  // note: cannot seem to serialise/resurect derived classes properly when saving to
  //       chrome.storage.local. it seems like we can currently (2024-11-28) only serialise/resurect
  //       classes in the langchain or langchain-core namespaces... for now, we explicitly save
  //       .store after any changes in .mset() and .mdelete().

  constructor(store?: Record<string, Bookmark>) {
    super(...arguments);
    this.lc_serializable = true;
    this.store = store ?? {};
  }

  override async mset(items: [string, Document][]): Promise<void> {
    for (const [key, value] of items) {
      this.store[key] = Bookmark.fromDocument(value);

      // save to db
      await db.upsert(key, (existing) => ({
        ...existing,
        ...this.store[key],
      }));
    }
  }

  override async mget(keys: string[]): Promise<(Document | undefined)[]> {
    return keys.map((key) => this.store[key] ?? undefined);
  }

  override async mdelete(keys: string[]): Promise<void> {
    for (const key of keys) {
      delete this.store[key];
      try {
        const doc = await db.get(key);
        await db.remove(doc);
      } catch {
        // doesn't exist... nothing to do?
      }
    }
  }

  override async *yieldKeys(
    prefix?: string | undefined,
  ): AsyncGenerator<string> {
    for (const key of Object.keys(this.store)) {
      if (prefix === undefined || key.startsWith(prefix)) {
        yield key;
      }
    }
  }

  // update a document/bookmark post hoc - allows us to update a document in the store after it is added
  async update(key: string, fields: Record<string, any>): Promise<void> {
    // update the in memory store...
    if (this.store[key]) {
      Object.assign(this.store[key].metadata, fields);
    }
    // ... and the db
    await db.upsert(key, (existing) => ({
      ...existing,
      metadata: {
        ...(existing as any).metadata,
        ...fields,
      },
    }));
  }}

// const dStore = new InMemoryStore<Uint8Array>(); // FIXME: get from storage.local?
const dStore = new InMemoryLocalStore({}); // empty store
// initLocalCache.then(() => {
//   console.log("Loaded local cache:", localCache);
//   dStore.store = localCache.bookmarks as Record<string, Bookmark>;
// });
const initLocalCache = migrate(db).then(() =>
  db.allDocs({ include_docs: true }).then((result) => {
    result.rows
      .filter((row) => !row.id.startsWith('migration_') && !row.id.startsWith('meta'))
      .forEach((row) => {
        dStore.store[row.id] = Bookmark.fromDocument(row.doc as unknown as Document);
      });
  })
);

/*
 * bookmark abstraction...
 */
export class Bookmark extends Document<Record<string, any>> {
  constructor(fields: any) {
    super(fields);
    this.metadata = {
      title: fields.title ? fields.title : null,
      href: fields.href ? fields.href : null,
      host: fields.host ? fields.host : null,
      visits: fields.visits ? fields.visits : [],
      nrVectors: fields.nrVectors ?? null,
      indexed: fields.indexed ?? false,
    };
    this.pageContent = fields.excerpt ? fields.excerpt : "";
    this.id = fields.id ? fields.id : null;
  }

  get title() {
    return this.metadata["title"];
  }
  set title(value: string) {
    this.metadata["title"] = value;
  }

  get href() {
    return this.metadata["href"];
  }
  set href(value: string) {
    this.metadata["href"] = value;
  }

  get host() {
    return this.metadata["host"];
  }
  set host(value: string) {
    this.metadata["host"] = value;
  }

  get excerpt() {
    return this.pageContent;
  }
  set excerpt(value: string) {
    this.pageContent = value;
  }

  get visits(): number[] {
    return this.metadata["visits"] ?? [];
  }
  set visits(value: number[]) {
    this.metadata["visits"] = value;
  }

  get count(): number {
    return this.visits.length;
  }

  get date(): number {
    return this.visits[0] ?? 0; // 1970-01-01:00:00:00Z
  }

  get nrVectors(): number | null {
    return this.metadata["nrVectors"] ?? null;
  }
  set nrVectors(value: number | null) {
    this.metadata["nrVectors"] = value;
  }

  get indexed(): boolean {
    return this.metadata["indexed"] ?? false;
  }
  set indexed(value: boolean) {
    this.metadata["indexed"] = value;
  }

  // static factory method(s)
  static fromDocument(doc: Document<Record<string, any>>): Bookmark {
    // handle legacy format: date + count -> visits (c.f. migration_20260311)
    let visits: number[] = [];
    if ("visits" in doc.metadata) {
      visits = doc.metadata["visits"];
    } else if ("date" in doc.metadata) {
      const count = doc.metadata["count"] ?? 1;
      visits = Array(count).fill(doc.metadata["date"]);
    }

    const instance = new Bookmark({
      id: doc.id,
      title: "title" in doc.metadata ? doc.metadata["title"] : null,
      href: "href" in doc.metadata ? doc.metadata["href"] : null,
      host: "host" in doc.metadata ? doc.metadata["host"] : null,
      excerpt: doc.pageContent,
      visits: visits,
      nrVectors: "nrVectors" in doc.metadata ? doc.metadata["nrVectors"] : null,
      indexed: "indexed" in doc.metadata ? doc.metadata["indexed"] : true, // default: true (existing Bookmarks without .indexed are assumed to be indexed)
    });
    return instance;
  }
}

// TODO: methods for loading and storing bookmarks

// add document/bookmark to dStore
async function addBookmark(doc: Record<string, Document>) {
  await dStore.mset(Object.entries(doc));
}

/*
 * Retriever...
 */

import { ScoredParentDocumentRetriever } from "./scored-retriever";

let retriever: ScoredParentDocumentRetriever | null = null;

let resolveReady: () => void;
const readyPromise = new Promise<void>((resolve) => {
  resolveReady = resolve;
});

function ready(): Promise<void> {
  return readyPromise;
}

import settings, { Setting } from "./settings";

function setup(settings: any): Promise<ScoredParentDocumentRetriever> {
  // set up the retriever with the supplied settings
  console.log("Setting up the retriever with settings:", settings);

  return initLocalCache.then(() => new Promise<ScoredParentDocumentRetriever>((resolve, reject) => {
    // embedding model
    if (!settings["embedding-model"].value) {
      reject(new Error("No embedding model specified."));
    }
    const model = new HuggingFaceTransformersEmbeddingsSmlMem({
      // batchSize: 128,
      model: settings["embedding-model"].value, // e.g., "Xenova/all-MiniLM-L6-v2"
    });

    // vector store
    if (
      !settings["pinecone-index"].value ||
      !settings["pinecone-api-key"].value
    ) {
      reject(new Error("Pinecone settings not initialized."));
    }
    const pc = new PineconeClient({
      apiKey: settings["pinecone-api-key"].value,
    });
    const index = pc
      .index(settings["pinecone-index"].value)
      .namespace(settings["pinecone-namespace"].value); // FIXME: .Index vs .index?

    const vStore = PineconeStoreNoContent.fromExistingIndex(model, {
      pineconeIndex: index,
      maxConcurrency: 5,
    });

    // document store
    // const dStore = new InMemoryStore<Uint8Array>(); // FIXME: get from storage.local?
    // const dStore = new InMemoryLocalStore();
    // initLocalCache.then(() => {
    //   console.log("Loaded local cache:", localCache);
    //   dStore.store = localCache.bookmarks as Record<string, Bookmark>;
    // });

    Promise.all([vStore])
      .then((values) => {
        const [vStore] = values;

        // finally... the retriever
        const retriever = new ScoredParentDocumentRetriever({
          vectorstore: vStore,
          docstore: dStore,

          // not required, we're not interested in retrieving chunks within the parent documents
          // parentSplitter: new RecursiveCharacterTextSplitter({
          //   chunkOverlap: 0,
          //   chunkSize: 500,
          // }),
          childSplitter: new NaiveTextSplitter(),

          // the number of nearest neighbours (i.e., child documents) to retrieve
          childK: settings["search-child-limit"].value as number,
          
          // upper bound on the number of parent documents to return
          parentK: settings["search-result-limit"].value as number,

          similarityThreshold: settings["search-similarity-threshold"].value as number,
          topK: settings["search-top-k"].value as number,
          b: settings["search-length-penalty"].value as number,
        });
        resolve(retriever);
      })
      .catch((err) => {
        reject(err);
      });
  }));
}

// initialise the retriever...
settings.get().then((_settings) => {
  // FIXME: ugly!!
  const ss = Object.fromEntries(
    (_settings as Setting[]).map((value) => {
      return [value.name, { value: value.value }];
    }),
  );

  setup(ss)
    .then((_retriever) => {
      console.log("Retriever initialised.");
      retriever = _retriever;
      resolveReady();
    })
    .catch((err) => {
      console.error("Retriever initialisation failed:", err);
      retriever = null;
      // throw err;
    });
});

// listen for changes to settings that affect the retriever
settings.addListener(
  [
    "embedding-model",
    "pinecone-index",
    "pinecone-namespace",
    "pinecone-api-key",
    "search-result-limit",
    "search-similarity-threshold",
    "search-child-limit",
    "search-top-k",
    "search-length-penalty",
  ],
  (changes) => {
    setup(changes.newValue)
      .then((_retriever) => {
        console.log("Retriever initialised.");
        retriever = _retriever;
      })
      .catch((err) => {
        console.error("Retriever initialisation failed:", err);
        retriever = null;
        // throw err;
      });
  },
);

// delete vectors from vStore
async function deleteVectors(id: string): Promise<void> {
  const vStore = retriever!.vectorstore as PineconeStore; // local ref?
  const index = vStore.pineconeIndex;

  console.log("deleteVectors: id =", id);

  // find records matching id prefix
  let records = await index.listPaginated({ prefix: `${id}:` }); // matches hash:[uuid]

  let ids =
    records.vectors
      ?.map(v => v.id)
      .filter((id): id is string => id !== undefined) ?? [];

  while (records.pagination) {
    records = await index.listPaginated({
      paginationToken: records.pagination.next
    });
    ids.push(
      ...(records.vectors
        ?.map(v => v.id)
        .filter((id): id is string => id !== undefined) ?? [])
    );
  }

  console.log("deleteVectors: found", ids.length, "vectors to delete");

  // remove from vStore
  const batches = chunkArray(ids, 1000);
  for (const batch of batches) {
    await index.deleteMany(batch);
  }

  // update nrVectors and indexed in dStore
  await dStore.update(id, { nrVectors: 0, indexed: false });
}

// embed bookmark (title + text) and upsert vectors to vStore
async function embedAndUpsert(id: string, fields: { title: string, text?: string }): Promise<void> {
  // create Document(s) for embedding
  let docs = [new Document({ id, pageContent: fields.title })];
  if (fields.text) {
    docs.push(new Document({ id, pageContent: fields.text }));
  }

  // add to retriever
  return retriever!.addDocuments(docs, {
    addToDocstore: false,
    ids: Array(docs.length).fill(id),
  });
}

/*
 * public interface
 */

// add bookmark
export async function add(id: string, fields: any): Promise<void> {
  if (!retriever) {
    throw new Error("Retriever not initialised.");
  }

  // create Bookmark to store
  const bmk = new Bookmark({ id: id, visits: [Date.now()], ...fields });

  // add to dStore
  await addBookmark({ [id]: bmk });

  if (!fields.text) {
    return dStore.update(id, { nrVectors: 0 }); // non-readerable — store locally only, skip embedding
  }

  return embedAndUpsert(id, fields);
}

// delete bookmark by id
export async function del(id: string, options: { vectorsOnly?: boolean } = {}): Promise<void> {
  if (!retriever) {
    throw new Error("Retriever not initialised.");
  }

  const vStore = retriever.vectorstore as PineconeStore; // local ref?
  const index = vStore.pineconeIndex;

  if (id.length === 0) {
    // remove *all* records from vStore
    await index.deleteAll();

    if (options.vectorsOnly) return;

    // remove *all* records from dStore
    const ids = [];
    for await (const id of dStore.yieldKeys()) {
      ids.push(id);
    }
    return dStore.mdelete(ids);
  }

  // remove from vStore
  await deleteVectors(id);

  if (options.vectorsOnly) return;

  // remove from dStore
  return dStore.mdelete([id]);
}

// update bookmark by id
export async function update(
  id: string,
  fields: Record<string, any>,
  options: { text?: string } = {}
): Promise<void> {
  if ((options.text !== undefined) && (!retriever)) {
    throw new Error("Retriever not initialised."); // fail early, update nothing
  }

  // update bookmark metadata in dStore...
  if (Object.keys(fields).length > 0) {
    await dStore.update(id, fields);
  }

  // ... and vectors in vStore if text is provided
  if (options.text !== undefined) {
    const bmk = dStore.store[id];
    if (!bmk) {
      throw new Error(`Bookmark ${id} not found.`);
    }

    // delete existing vectors for this bookmark (if any)...
    await deleteVectors(id);

    // ... and upsert new vectors
    await embedAndUpsert(id, { title: bmk.title, text: options.text });
  }
}

export async function select(
  predicate: (bmk: Bookmark) => boolean = () => true,
  limit?: number,
): Promise<Bookmark[]> {
  const results: Bookmark[] = [];
  for (const bmk of Object.values(dStore.store)) {
    if (predicate(bmk)) {
      results.push(bmk);
      if (limit && results.length >= limit) break;
    }
  }
  return results;
}

// similarity search on bookmark embeddings
export async function search(query: string): Promise<Bookmark[]> {
  if (!retriever) {
    throw new Error("Retriever not initialised.");
  }

  return retriever
    .invoke(query)
    .then((results) => {
      return results.map((doc) => Bookmark.fromDocument(doc));
    })
    .catch((err) => {
      console.error("Search error:", err);
      console.error("Search error stack:", err.stack);
      throw err;
    });
}

export async function exists(ids: string[]): Promise<Record<string, boolean>> {
  return Object.fromEntries(ids.map(id => [id, id in dStore.store]));
}

// dump/export browsing history to file
import { FetchResponse } from "@pinecone-database/pinecone";

function exprnd(lambda: number): number {
  return -Math.log(1 - Math.random()) / lambda;
}

// export browsing history as json string
export async function toJSON(): Promise<string> {
  // returns the downloadId or undefined
  if (!retriever) {
    throw new Error("Retriever not initialised.");
  }

  // FIXME: check LSU is >= the LSU returned by the last upsert/delete operation

  // // get *all* vectors from the vector store
  // const vStore = retriever.vectorstore as PineconeStore;
  // const index = vStore.pineconeIndex;

  // let promises = []; // empty promises

  // let records = await index.listPaginated({});
  // while (records.pagination) {
  //   records = await index.listPaginated({
  //     paginationToken: records.pagination.next,
  //   });
  //   const ids = records.vectors
  //     ? records.vectors.map((vector) => vector.id)
  //     : [];

  //   promises.push(
  //     new Promise((resolve) => {
  //       setTimeout(
  //         () => resolve(index.fetch(ids.filter((id) => id !== undefined))),
  //         Math.min(exprnd(0.5), 2.0) * 1000, // rate limiting, is this necessary?
  //       );
  //     }),
  //   );
  // }

  // return Promise.all(promises)
  //   .then((results) => {
  //     console.log("Results:", results.length);

  //     const records = {};
  //     results.forEach((result) => {
  //       Object.assign(records, (result as FetchResponse).records);
  //     });

  //     return records;
  //   })
  //   .then((records) => {
  //     console.log("Records:", Object.keys(records).length);

  //     const obj = {
  //       bookmarks: dStore.store,
  //       vectors: {}, // records,
  //     };

  //     const json = JSON.stringify(obj, null, 2);

  //     // save to file
  //     // const url = URL.createObjectURL( // <-- can't do this in MV3
  //     //   new Blob([json], { type: "application/json" }),
  //     // );
  //     // return chrome.downloads.download({
  //     //   url: url,
  //     //   filename: ["shs-ext", new Date().toISOString()].join("_") + ".json",
  //     //   saveAs: true,
  //     // });
  //     return json;
  //   });

  const obj = {
    bookmarks: dStore.store,
    vectors: {}, // records,
  };

  const json = JSON.stringify(obj, null, 2);

  return json;
}

// import browsing history as json string
export async function fromJSON(json: string): Promise<void> {
  if (!retriever) {
    throw new Error("Retriever not initialised.");
  }
  const obj = JSON.parse(json);

  // update vStore
  const vStore = retriever.vectorstore as PineconeStore;
  const index = vStore.pineconeIndex;

  const pineconeVectors: PineconeRecord<RecordMetadata>[] = Object.values(
    obj.vectors,
  );

  const chunkSize = 500;
  const chunkedVectors = chunkArray(pineconeVectors, chunkSize);
  const vectorRequests = chunkedVectors.map((chunk) => {
    // return index.upsert(chunk);
    return new Promise((resolve) => {
      setTimeout(
        () => resolve(index.upsert(chunk)),
        Math.min(exprnd(0.5), 2.0) * 1000, // rate limiting, is this necessary?
      );
    });
  });

  // await Promise.all(vectorRequests); // FIXME: need to catch and store the max LSU for the upsert operations

  // update dStore
  const bookmarks = obj.bookmarks;
  const bookmarkRequests = Object.entries(bookmarks).map(([id, bmk]) => {
    return addBookmark({ [id]: bmk as Bookmark });
  });

  Promise.all([...vectorRequests, ...bookmarkRequests]).then(() => {
    return;
  });
}

// report vector store/index statistics (e.g., number of vectors, index size, etc.)
export async function indexStats(): Promise<{ vectorCount: number }> {
  if (!retriever) {
    throw new Error("Retriever not initialised.");
  }

  const vStore = retriever.vectorstore as PineconeStore;
  const index = vStore.pineconeIndex;
  const stats = await index.describeIndexStats();
  console.log("index stats:", JSON.stringify(stats));

  return { vectorCount: stats.totalRecordCount ?? 0 };
}


export async function getNrVectors(id: string): Promise<number> {
  if (!retriever) {
    throw new Error("Retriever not initialised.");
  }

  const vStore = retriever.vectorstore as PineconeStore;
  const index = vStore.pineconeIndex;

  let count = 0;
  let records = await index.listPaginated({ prefix: `${id}:` });
  count += records.vectors?.length ?? 0;

  while (records.pagination) {
    records = await index.listPaginated({
      paginationToken: records.pagination.next,
    });
    count += records.vectors?.length ?? 0;
  }

  return count;
}


// migrate/rename bookmark from oldId to newId, e.g, unnormalized to normalized url hash 
export async function rename(oldId: string, newId: string): Promise<void> {
  if (!retriever) {
    throw new Error("Retriever not initialised.");
  }

  // check existingOld exists
  const existingOld = (await select(b => b.id === oldId, 1))[0];
  if (!existingOld) {
    console.error(`rename: bookmark ${oldId} not found.`);
    return;
  }

  // check existingNew does not exist
  const existingNew = (await select(b => b.id === newId, 1))[0];
  if (existingNew) {
    console.error(`rename: bookmark ${newId} already exists — unexpected state, skipping.`);
    return;
  }

  const vStore = retriever!.vectorstore as PineconeStore;
  const index = vStore.pineconeIndex;

  // collect all old vector ids
  let oldVectorIds: string[] = [];
  let records = await index.listPaginated({ prefix: `${oldId}:` });
  oldVectorIds.push(...(records.vectors?.map(v => v.id).filter((id): id is string => id !== undefined) ?? []));
  while (records.pagination) {
    records = await index.listPaginated({ paginationToken: records.pagination.next });
    oldVectorIds.push(...(records.vectors?.map(v => v.id).filter((id): id is string => id !== undefined) ?? []));
  }

  if (oldVectorIds.length > 0) {
    // fetch vectors in batches of 100 (Pinecone limit)
    const batches = chunkArray(oldVectorIds, 100);
    const fetchedVectors: PineconeRecord<RecordMetadata>[] = [];

    for (const batch of batches) {
      const response = await new Promise<FetchResponse>((resolve) => {
        setTimeout(
          () => resolve(index.fetch(batch)),
          Math.min(exprnd(0.5), 2.0) * 1000,
        );
      });
      fetchedVectors.push(...Object.values(response.records));
    }

    // re-upsert with new id prefix, preserving uuid suffix
    const newVectors: PineconeRecord<RecordMetadata>[] = fetchedVectors.map(v => ({
      ...v,
      id: `${newId}:${v.id.split(':')[1]}`,
    }));

    const upsertBatches = chunkArray(newVectors, 100);
    for (const batch of upsertBatches) {
      await new Promise((resolve) => {
        setTimeout(
          () => resolve(index.upsert(batch)),
          Math.min(exprnd(0.5), 2.0) * 1000,
        );
      });
    }

    // delete old vectors (could be a call to deleteVectors(), but we already have oldvectorIds here)
    const deleteBatches = chunkArray(oldVectorIds, 1000);
    for (const batch of deleteBatches) {
      await index.deleteMany(batch);
    }
  }

  // create new bookmark with newId and normalised href
  const newBmk = new Bookmark({
    id: newId,
    title: existingOld.title,
    href: existingOld.href,
    host: existingOld.host,
    excerpt: existingOld.excerpt,
    visits: existingOld.visits,
    nrVectors: existingOld.nrVectors,
  });
  await addBookmark({ [newId]: newBmk });

  // delete old bookmark
  await dStore.mdelete([oldId]);
}

export default { add, del, update, select, search, exists, ready, toJSON, fromJSON, indexStats, getNrVectors, rename };
