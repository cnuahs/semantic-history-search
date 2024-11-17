// 2024-11-11 - Shaun L. Cloherty <s.cloherty@ieee.org>

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

export class NaiveTextSplitter
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
env.allowLocalModels = true;
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

export const modl = new HuggingFaceTransformersEmbeddingsSmlMem({
  // batchSize: 128,
  model: "Xenova/all-MiniLM-L6-v2"
});

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

export class PineconeStoreNoContent
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

import { PINECONE_API_KEY } from "./secrets";
const pc = new PineconeClient({ apiKey: PINECONE_API_KEY });

const namespace = ""; // default: empty namespace
const index = pc.index("vhs-ext").namespace(namespace); // FIXME: .Index vs .index?

const vStore = await PineconeStoreNoContent.fromExistingIndex(modl, { pineconeIndex: index, maxConcurrency: 5 });


/*
 * "document" store... actually, where we'll store bookmarks
 */

import { InMemoryStore } from "@langchain/core/stores"

export const dStore = new InMemoryStore<Uint8Array>(); // FIXME: get from storage.local?


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
async function storeBookmark( doc: Record<string, Document> ) {
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

const retriever = new ParentDocumentRetriever({
  vectorstore: vStore,
  byteStore: dStore,
  // Optional, not required if you're already passing in split documents
  // parentSplitter: new RecursiveCharacterTextSplitter({
  //   chunkOverlap: 0,
  //   chunkSize: 500,
  // }),
  childSplitter: new NaiveTextSplitter(),
  // Optional `k` parameter to search for more child documents in VectorStore.
  // Note that this does not exactly correspond to the number of final (parent) documents
  // retrieved, as multiple child documents can point to the same parent.
  childK: 500,
  // Optional `k` parameter to limit number of final, parent documents returned from this
  // retriever and sent to LLM. This is an upper-bound, and the final count may be lower than this.
  parentK: 5,
});


/*
 * public interface
 */

// add bookmark
export async function add(id: string, fields: any): Promise<void> {
  // create Bookmark to store
  const bmk = new Bookmark( { id: id, ...fields } );
    
  // add to dStore
  await storeBookmark({[id]: bmk});
  
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
  // remove from vStore
  if (id.length === 0) {
    // remove *all* records from the index!!
    await index.deleteAll();

    const ids = [];
    for await (const id of dStore.yieldKeys()) {
      ids.push(id);
    }
    return index.deleteMany(ids);
  }
  
  let records = await vStore.pineconeIndex.listPaginated( { prefix: `${id}:` } ); // matches hash:[uuid]

  let ids = records.vectors?.map(item => item.id).filter((id): id is string => id !== undefined) || [];
  while (records.pagination) {
    records = await index.listPaginated({ paginationToken: records.pagination.next });
    ids.push(...(records.vectors?.map(item => item.id).filter((id): id is string => id !== undefined) || []));
  }

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
  const results = await retriever.invoke(query);
  return Promise.resolve(results.map(doc => Bookmark.fromDocument(doc)));
}



























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
