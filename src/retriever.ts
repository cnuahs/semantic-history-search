// 2024-11-11 - Shaun L. Cloherty <s.cloherty@ieee.org>


// listen for changes to settings that affect the retriever
chrome.storage.onChanged.addListener((changes, namespace) => {
  for (let [key, { oldValue, newValue }] of Object.entries(changes)) {
    // console.log(
    //   `Storage key "${key}" in namespace "${namespace}" changed.`,
    //   `Old value was "${oldValue}", new value is "${newValue}".`
    // );

    if (namespace === "sync" && key === "settings") {
      setup(newValue)
      .then((_retriever) => {
        console.log("Retriever initialised.");
        retriever = _retriever;
      })
      .catch((err) => {
        console.error("Retriever initialisation failed:", err);
        retriever = null;
        // throw err;
      });
    }

    // handy for debugging...
    // if (namespace === "local" && key === "bookmarks") {
    //   // update the local cache?
    //   localCache.bookmarks = newValue;
    //   console.log("Updated local cache with bookmarks.", localCache);
    // }
  }
});

// const localCache: { bookmarks: LocalStore | null } = { bookmarks: null };
 // wtf, can only serialise/resurect serializable objects in the langchain or
// lancgain-core namespaces... as a workaround, for now just store the bookmarks.
const localCache: { bookmarks: Record<string, Bookmark> } = { bookmarks: {} };
const initLocalCache = chrome.storage.local.get().then((items) => {
    // copy all items to localCache
    Object.assign(localCache, items);
});

/*
 * text splitter(s)...
 */

// import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// const splitter = new RecursiveCharacterTextSplitter({
//   chunkSize: 100,
//   chunkOverlap: 0,
//   // separators: [".", "!", "?", ";", ":", "\n"],
// });

import { CharacterTextSplitter, CharacterTextSplitterParams } from "@langchain/textsplitters";

/*
 * The naive text splitter splits on sentence separators
 */
interface NaiveTextSplitterParams
  extends CharacterTextSplitterParams {
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
    this.lengthFunction = ( (text:string) => this.splitOnSeparator(text, this.separator).length ); // length in words
  }

  protected override splitOnSeparator(text: string, separator: string): string[] {
    let splits;
    if (separator) {
      const regexEscapedSeparator = separator.replace(
        /[/\-\\^$*+?.()|[\]{}]/g,
        "\\$&"
      );

      if (this.keepSeparator) {
        const re = new RegExp(`(?=${regexEscapedSeparator})`); // look ahead?
        splits = text.split(re)
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

  override async mergeSplits(splits: string[], separator: string = " "): Promise<string[]> {
    const docs: string[] = [];
    const thisDoc: string[] = [];
    let nrSplits = 0;
    for (const split of splits) {
      if ( nrSplits + 1 > this.chunkSize ) {
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
            ( nrSplits + 1 > this.chunkSize &&
              nrSplits > 0 )
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
};


/*
 * Embedding model...
 */

import { chunkArray } from "@langchain/core/utils/chunk_array";

import { env } from '@xenova/transformers';
env.allowLocalModels = false;
env.allowRemoteModels = true; // FIXME: make this false by default (need to bundle the model with the ext?)
env.useBrowserCache = true;

// disable multithreading in onnxruntime-web... hopefully this is a temporary fix!
// See https://github.com/huggingface/transformers.js
//     https://github.com/microsoft/onnxruntime/issues/14445
env.backends.onnx.wasm.numThreads = 1;

import { HuggingFaceTransformersEmbeddings, HuggingFaceTransformersEmbeddingsParams } from "@langchain/community/embeddings/hf_transformers";

interface HuggingFaceTransformersEmbeddingsSmlMemParams
  extends HuggingFaceTransformersEmbeddingsParams {
    // add properties here
}

class HuggingFaceTransformersEmbeddingsSmlMem
  extends HuggingFaceTransformersEmbeddings
  implements HuggingFaceTransformersEmbeddingsSmlMemParams {

    constructor(fields: any) {
      super(fields);
      this.batchSize = fields.batchSize ?? 256;
    }

    override async embedDocuments(docs: string[]): Promise<number[][]> {
      // reducing the embedding model .batchSize doesn't seem to ease memory requirements, because
      // the HuggingFaceTransformersEmbeddings class dispatches all batches concurrently.
      //
      // here we perform our own "batching" and await each batch before moving on to the next.
      console.log("Embedding %i documents", docs.length); console.time("Elapsed");
      let embeddings: number[][] = [];

      const batches: string[][] = chunkArray(docs, this.batchSize);
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        embeddings.push( ...await super.embedDocuments(batch) );
        console.log('Embedded %i documents', embeddings.length);
      }
      console.log("Done embedding %i documents", embeddings.length); console.timeEnd("Elapsed");
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

class PineconeStoreNoContent
  extends PineconeStore {

  // constructor(embeddings: EmbeddingsInterface, params: PineconeStoreParams) {
  //   super(embeddings, params);
  // }

  override async addDocuments(
    documents: Document[],
    options?: { ids?: string[]; namespace?: string } | string[]
  ): Promise<string[]>  {

    // Pinecone serverless indexes do not support deleting by metadata. BUT you can delete records
    // by Id prefix. Here we assign the doc_id (from .metadata) as a prefix... Ids will be of the
    // form "doc_id:uuid", allowing us to delete by prefix using "doc_id:".
    const ids = documents.map((doc) => doc.metadata && doc.metadata["doc_id"]? doc.metadata["doc_id"] + ":" + uuid.v4() : "");
    options = options? { ...options, ids: ids } : { ids: ids };

    const texts = documents.map(({ pageContent }) => pageContent);
    return this.addVectors(
      await this.embeddings.embedDocuments(texts),
      documents,
      options
    );
  }

  override async addVectors(
    vectors: number[][],
    documents: Document<Record<string, any>>[],
    options?: { ids?: string[]; namespace?: string } | string[]
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
      this.caller.call(async () => namespace.upsert(chunk))
    );

    await Promise.all(batchRequests);

    return documentIds;
  }
}

import { Pinecone as PineconeClient } from "@pinecone-database/pinecone";

/*
 * "document" store... actually, where we'll store bookmarks
 */

// import { InMemoryStore } from "@langchain/core/stores"
import { BaseStore } from "@langchain/core/stores"

// wtf? ParentDocumentRetriever currenly *only* supports document stores accepting Uint8Arrays...!?

// In-memory store using a dictionary, backed by chrome.storage.local.
export class InMemoryLocalStore extends BaseStore<string, Uint8Array> {
  override lc_namespace = [ ".", "retriever" ];
  override lc_serializable = true;

  store: Record<string, Bookmark> = {}; // serializable?

  // add .store to the list of attributes to be serialised
  override get lc_attributes(): string[] {
    return [ "store" ];
  }

  // note: cannot seem to serialise/resurect derived classes properly when saving to
  //       chrome.storage.local. it seems like we can currently (2024-11-28) only serialise/resurect
  //       classes in the langchain or langchain-core namespaces... for now, we explicitly save
  //       .store after any changes in .mset() and .mdelete().

  constructor( store?: Record<string, Bookmark> ) {
    super( ...arguments );
    this.lc_serializable = true;
    this.store = store ?? {};
  }

  override async mset(items: [string, Uint8Array][]): Promise<void> {
    for (const [key, value] of items) {
      // decode Uint8Array --> Bookmark to store
      this.store[key] = Bookmark.fromDocument(JSON.parse(new TextDecoder().decode(value)));
    }

    // save to chrome.storage.local...
    return chrome.storage.local.set({ bookmarks: this.store }); // FIXME: Object.values()?
  }

  override async mget(keys: string[]): Promise<(Uint8Array | undefined)[]> {
    return keys.map((key) => {
      const value = this.store[key];
      // encode Bookmark --> Uint8Array to return
      return value ? new TextEncoder().encode(JSON.stringify(value)) : undefined;
    });
  }

  override async mdelete(keys: string[]): Promise<void> {
    for (const key of keys) {
      delete this.store[key];
    }

    // save to chrome.storage.local...
    return chrome.storage.local.set({ bookmarks: this.store }); // FIXME: Object.values()?
  }

  override async *yieldKeys(prefix? : string | undefined): AsyncGenerator<string> {
    for (const key of Object.keys(this.store)) {
      if (prefix === undefined || key.startsWith(prefix)) {
        yield key;
      }
    }
  }
}

// const dStore = new InMemoryStore<Uint8Array>(); // FIXME: get from storage.local?
const dStore = new InMemoryLocalStore({}); // empty store
initLocalCache.then(() => {
  console.log("Loaded local cache:", localCache);
  dStore.store = localCache.bookmarks as Record<string, Bookmark>;
});

/*
 * bookmark abstraction...
 */
export class Bookmark
  extends Document<Record<string, any>> {

  constructor(fields: any) {
    super(fields);
    this.metadata = {
      title: fields.title ? fields.title : null,
      href: fields.href ? fields.href : null,
      host: fields.host ? fields.host : null,
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

  // static factory method(s)
  static fromDocument(doc: Document<Record<string, any>>) : Bookmark {
    const instance = new Bookmark( {
      id: doc.id,
      title: doc.metadata? doc.metadata["title"] : null,
      href: doc.metadata? doc.metadata["href"] : null,
      host: doc.metadata? doc.metadata["host"] : null,
      excerpt: doc.pageContent
    });
    return instance;
  }
}

// TODO: methods for loading and storing bookmarks

// add document/bookmark to dStore
async function addBookmark( doc: Record<string, Document> ) {
  // console.dir(doc)

  // serialize the document and store it in the docstore
  const docs: [string, Uint8Array][] = Object.entries(doc).map(([key, value]) => {
    // console.log("key:", key);
    // console.log("value:", value);
    return [key, new TextEncoder().encode(JSON.stringify(value))];
  });
  // console.dir(docs);

  await dStore.mset(docs);
}


/*
 * Retriever...
 */

import { ParentDocumentRetriever } from "langchain/retrievers/parent_document";

let retriever: ParentDocumentRetriever | null = null;

import settings from "./settings"
import { Setting } from "./settings";

function setup(settings: any): Promise<ParentDocumentRetriever> {
  // set up the retriever with the supplied settings
  console.log("Setting up the retriever with settings:", settings);

  return new Promise<ParentDocumentRetriever>((resolve, reject) => {

    // embedding model
    // if (!settings["embedding-model"].value) {
    //   reject(new Error("No embedding model specified."));
    // }
    const model = new HuggingFaceTransformersEmbeddingsSmlMem({
      // batchSize: 128,
      model: "Xenova/all-MiniLM-L6-v2" // settings["embedding-model"].value
    });

    // vector store 
    if (!settings["pinecone-index"].value || !settings["pinecone-api-key"].value) {
      reject(new Error("Pinecone settings not initialized."));
    }
    const pc = new PineconeClient({ apiKey: settings["pinecone-api-key"].value });
    const index = pc.index(settings["pinecone-index"].value).namespace(settings["pinecone-namespace"].value); // FIXME: .Index vs .index?
  
    const vStore = PineconeStoreNoContent.fromExistingIndex(model, { pineconeIndex: index, maxConcurrency: 5 });

    // document store
    // const dStore = new InMemoryStore<Uint8Array>(); // FIXME: get from storage.local?
    // const dStore = new InmemoryLocalStore();
    // initLocalCache.then(() => {
    //   console.log("Loaded local cache:", localCache);
    //   dStore.store = localCache.bookmarks as Record<string, Bookmark>;
    // });

    Promise.all([vStore])
    .then((values) => {
      const [ vStore ] = values;

      // finally... the retriever
      const retriever = new ParentDocumentRetriever({
        vectorstore: vStore,
        byteStore: dStore,
        
        // not required, we're not interested in retrieving chunks within the parent documents
        // parentSplitter: new RecursiveCharacterTextSplitter({
        //   chunkOverlap: 0,
        //   chunkSize: 500,
        // }),
        childSplitter: new NaiveTextSplitter(),

        childK: 500, // the number of nearest neighbours (i.e., child documents) to retrieve
        parentK: 5, // upper bound on the number of parent document to return
      });
      resolve(retriever);
    })
    .catch((err) => {
      reject(err);
    });
  });
}

// initialise the retriever...
settings.get().then((_settings) => {
  // FIXME: ugly!!
  const ss = Object.fromEntries((_settings as Setting[]).map((value) => {return [value.name, { value: value.value }]}));

  setup(ss)
  .then((_retriever) => {
    console.log("Retriever initialised.");
    retriever = _retriever;
  })
  .catch((err) => {
    console.error("Retriever initialisation failed:", err);
    retriever = null;
    // throw err;
  });
});


/*
 * public interface
 */

// add bookmark
export async function add(id: string, fields: any): Promise<void> {
  if (!retriever) {
    throw new Error("Retriever not initialised.");
  }

  // create Bookmark to store
  const bmk = new Bookmark( { id: id, ...fields } );
    
  // add to dStore
  await addBookmark({[id]: bmk});
  
  // create Document for embedding
  const doc = new Document({ id: id, pageContent: fields.text });

  // add to retriever
  return retriever.addDocuments([doc], {
    addToDocstore: false,
    ids: [id]
  });
}

// delete bookmark by id
export async function del(id: string): Promise<void> {
  if (!retriever) {
    throw new Error("Retriever not initialised.");
  }

  const vStore = retriever.vectorstore as PineconeStore; // local ref?
  const index = vStore.pineconeIndex;

  if (id.length === 0) {
    // remove *all* records from vStore
    await index.deleteAll();

    // remove *all* records from dStore
    const ids = [];
    for await (const id of dStore.yieldKeys()) {
      ids.push(id);
    }
    return dStore.mdelete(ids);
  }

  // find records matching id prefix
  let records = await index.listPaginated( { prefix: `${id}:` } ); // matches hash:[uuid]

  let ids = records.vectors?.map(item => item.id).filter((id): id is string => id !== undefined) || [];
  while (records.pagination) {
    records = await index.listPaginated({ paginationToken: records.pagination.next });
    ids.push(...(records.vectors?.map(item => item.id).filter((id): id is string => id !== undefined) || []));
  }

  // remove from vStore
  const batches = chunkArray(ids, 1000);
  for (let i = 0; i < batches.length; i++) {
    await index.deleteMany(batches[i] || []);
  }
  
  // remove from dStore
  return dStore.mdelete([id]);
}

// get bookmarks by id
export async function get(id: string[]): Promise<Bookmark[]> {
  const results = await dStore.mget(id);
  return results.map((bmk) => bmk ? JSON.parse(new TextDecoder().decode(bmk)) : null);
}

// similarity search on bookmark embeddings
export async function search(query: string): Promise<Bookmark[]> {
  if (!retriever) {
    throw new Error("Retriever not initialised.");
  }

  return retriever.invoke(query)
  .then((results) => {
    return results.map(doc => Bookmark.fromDocument(doc));
  })
  .catch((err) => {
    throw err;
  });
}

export default { add, del, get, search };

























// ---------------
// legacy code below here...

interface Chunk {
  index: number;
  text: string;
  embedding: number[];
}

import { Embeddings } from "@langchain/core/embeddings";

async function splitNaive(text: string, N: number[] = [0]): Promise<Chunk[]> {
  // naive splitting... split by sentence
  let chunks: Chunk[] = [];
  if (N.length > 1) {
    chunks.push( ...await splitNaive(text, N.slice(0,1)), ...await splitNaive(text, N.slice(1,N.length)) ); // recursive call
    return chunks
  }
  const sentences = text.split(/(?:[\.\?\!])/);
  const n = N[0];
  for (let i = 0; i < sentences.length; i++) {
    let tmp = [];
    for (let j = i-n; j < i; j++) {
      if (j >= 0) {
        tmp.push(sentences[j]);
      }
    }
    
    tmp.push(sentences[i]);
    for (let j = i+1; j < i+1+n; j++) {
      if (j < sentences.length) {
        tmp.push(sentences[j]);
      }
    }
    chunks.push({ index: i, text: tmp.join(" "), embedding: [] });
  }
  return Promise.resolve(chunks);
}
    
import { cosineSimilarity } from '@langchain/core/utils/math';

async function splitSemantic(text: string, N: number = 1, model: Embeddings): Promise<Chunk[]> {
  // crude "semantic" splitting... split by sentence similarity
  const sentences = await splitNaive(text);

  let chunks: Chunk[] = await splitNaive(text, [N]);

  // generate embeddings...
  console.groupCollapsed("Embedding", chunks.length, "chunks");
  console.time("Elapsed");
  let embeddings = await model.embedDocuments(chunks.map(item => item.text));
  console.timeEnd("Elapsed");
  console.groupEnd();

  // calculate cosine similarity between chunks
  const M = chunks.length;
  const similarity: number[][] = cosineSimilarity(embeddings.slice(0,M-1), embeddings.slice(1,M));
  const distances: number[] = similarity.map((item,index) => 1 - item[index]);

  for (let i = 0; i < M; i++) {
    chunks[i].embedding = embeddings[i];
  }

  // find 95th percentile of the distribution of distance metrics
  const threshold = distances.sort()[Math.floor(0.95 * distances.length)];

  // find break points, i.e., sequential chunks with distances exceeding the threshold
  let breaks = distances.filter(dist => dist > threshold).map((_dist: number,index: number) => index);

  console.log("Found %i break points (%i chunks?)", breaks.length, breaks.length+1);
  
  if (breaks.at(-1)! < M-1) {
    breaks.push(M-1);
  }

  // new *parent* chunks
  let parents: Chunk[] = [];

  // iterate over break points and join sentences to form parent chunks
  let idx = 0;
  for (let i = 0; i < breaks.length; i++) {
    let idx1 = breaks[i] + 1;

    // concatenate sentences within the parent chunk
    const tmp = sentences.slice(idx,idx1);
    parents.push({ index: idx, text: tmp.join(" "), embedding: [] });

    idx = idx1;
  }

  // get embeddings for the parent chunks...
  console.groupCollapsed("Embedding", parents.length, "parent chunks");
  console.time("Elapsed");
  embeddings = await model.embedDocuments(parents.map(item => item.text));
  console.timeEnd("Elapsed");
  console.groupEnd();

  for (let i = 0; i < parents.length; i++) {
    parents[i].embedding = embeddings[i];
  }

  chunks = [...chunks, ...parents];

  return Promise.resolve(chunks);
}

// Pinecone helper functions

// import { chunkArray } from "@langchain/core/utils/chunk_array";
import { Index } from "@pinecone-database/pinecone";

async function removeFromIndex(index: Index, ids: string[]) {
  if (ids.length === 0) {
    // remove *all* records from the index!!
    let records = await index.listPaginated();

    ids = records.vectors?.map(item => item.id).filter((id): id is string => id !== undefined) || [];
    while (records.pagination) {
      records = await index.listPaginated({ paginationToken: records.pagination.next });
      ids.push(...(records.vectors?.map(item => item.id).filter((id): id is string => id !== undefined) || []));
    }
  }

  const batches = chunkArray(ids, 1000);
  for (let i = 0; i < batches.length; i++) {
    await index.deleteMany(batches[i] || []);
  }

  // await index.deleteMany(ids || []);
}

async function addToIndex(index: Index, chunks: Chunk[], ids: string[]) {
  const vectors = chunks.map((chunk, index) => {
    return {
      id: ids[index],
      values: chunk.embedding
    };
  });

  await index.upsert(vectors);
}

async function listIndex(index: Index, id: string) {
  let records = await index.listPaginated({ prefix: id });

  let results = records.vectors || [];
  while (records.pagination) {
    records = await index.listPaginated({ paginationToken: records.pagination.next });
    results.push(...(records.vectors || []));
  }  

  return results.map(item => item.id).filter((id): id is string => id !== undefined) || [];
}
