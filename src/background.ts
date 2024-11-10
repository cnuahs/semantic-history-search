// background (service worker) script

// import { RecursiveCharacterTextSplitter } from "@langchain/textsplitters";

// const splitter = new RecursiveCharacterTextSplitter({
//   chunkSize: 100,
//   chunkOverlap: 0,
//   // separators: [".", "!", "?", ";", ":", "\n"],
// });

import { env } from '@xenova/transformers';
env.allowLocalModels = true;
env.allowRemoteModels = false;
env.useBrowserCache = true;

// disable multithreading in onnxruntime-web... hopefully this is a temporary fix!
// See https://github.com/huggingface/transformers.js
//     https://github.com/microsoft/onnxruntime/issues/14445
env.backends.onnx.wasm.numThreads = 1;

import { HuggingFaceTransformersEmbeddings } from "@langchain/community/embeddings/hf_transformers";
const modl = new HuggingFaceTransformersEmbeddings({
  // batchSize: 128,
  model: "Xenova/all-MiniLM-L6-v2"
});

// import { HuggingFaceInferenceEmbeddings } from "@langchain/community/embeddings/hf";
// const model = new HuggingFaceInferenceEmbeddings({
//   model: "sentence-transformers/all-MiniLM-L6-v2",
//   apiKey: "API_KEY"
// })

import { cosineSimilarity } from '@langchain/core/utils/math';

interface Chunk {
  index: number;
  text: string;
  embedding: number[];
}

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

import { Embeddings } from "@langchain/core/embeddings";
import { chunkArray } from "@langchain/core/utils/chunk_array";

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

function bin2hex(buf: ArrayBuffer) {
  const hex = Array.from(new Uint8Array(buf))
    .map((byte) => byte.toString(16).padStart(2,'0')).join('');
  return hex;
}

async function sha256(str: string) {
  const utf8 = new TextEncoder().encode(str);
  return bin2hex(await crypto.subtle.digest('SHA-256', utf8));
}

// import { PineconeStore } from "@langchain/pinecone";
import { Pinecone as PineconeClient, Index } from "@pinecone-database/pinecone";

const pc = new PineconeClient({ apiKey: "API-KEY" });

const namespace = ""; // default: empty namespace
const pcIndex = pc.index("vhs-ext").namespace(namespace); // FIXME: .Index vs .index?
// const pcStore = await PineconeStore.fromExistingIndex(modl, { pineconeIndex: pcIndex, maxConcurrency: 5 });

// import { Document } from "@langchain/core/documents";

// register a content script to run on all pages
chrome.scripting.registerContentScripts([{
    id : "vhs-content-script",
    matches : [ "https://towardsdatascience.com/*", "https://medium.com/*" ], //[ "https://*/*", "http://*/*" ],
    runAt : "document_idle",
    js : [ "content.js" ],
  }])
  .then(() => console.log("Registered content script."))
  .catch((err) => console.warn("Registering content script failed:", err));

// listen for messages from the payload.js script
chrome.runtime.onMessage.addListener(function (message) {
  console.log("Received message (%s)", message.host);
  
  Promise.all([ sha256(message.href), splitNaive(message.text,[1]) ])
  .then(async (results) => {
    let [hash, chunks] = results;

    console.log("SHA256: %s", hash);

    console.groupCollapsed("Chunk statistics");
    console.log("Found", chunks.length, "chunks");
  
    const n = chunks.map(chunk => chunk.text.split(/\s/).length); // count words in each chunk
    console.log("Chunk size (words): %i, %i, %i (min, mean, max)", Math.min(...n), Math.ceil(n.reduce((sum, a) => sum + a, 0)/n.length), Math.max(...n));
    console.groupEnd();

    // search storage.sync for the hash
    
    // if found, update the metadata (timestamp etc.?) and return

    const M = chunks.length; // number of chunks to embed and upsert (useful for testing)

    // if not found, generate embeddings...
    // let embeddings: number[][] = [];
    if (chunks.map(chunk => chunk.embedding.length > 0).indexOf(true) === -1) {
      console.groupCollapsed("Embedding", chunks.length, "chunks");
      console.time("Elapsed");
      
      // const embeddings: number[][] = await modl.embedDocuments(chunks.slice(0,M).map(item => item.text));
      // 
      // chunks.slice(0,M).forEach((chunk, index) => {
      //   chunk.embedding = embeddings[index]; //.map((item,index) => item*(index === 0 ? 1 : 0));
      // });

      // reducing the embedding model .batchSize doesn't seem to ease memory requirements, because
      // the HuggingFaceTransformersEmbeddings class dispatches all batches concurrently.
      //
      // here we perform our own "batching", await'ing each batch of embeddings before moving on to the next.
      const batches = chunkArray(chunks.slice(0,M), modl.batchSize > 256 ? 256 : modl.batchSize);
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i];
        const embeddings = await modl.embedDocuments(batch.map(item => item.text));
        batch.forEach((chunk, index) => {
          chunk.embedding = embeddings[index];
        });
      }

      console.timeEnd("Elapsed");
      console.groupEnd();
    }

    // generate chunk ids, i.e., hash#index
    const ids: string[] = chunks.slice(0,M).map(chunk => `${hash}#${chunk.index}`);

    // search pinecone index for ids matching the hash prefix, i.e., hash#[index]
    let kill: string[] = await listIndex(pcIndex,`${hash}#`);
    kill = kill.filter(id => !ids.includes(id));
    if (kill.length > 0) {
      console.groupCollapsed("Removing", kill.length, "chunks");
      console.time("Elapsed");
      await removeFromIndex(pcIndex, kill);
      console.timeEnd("Elapsed");
      console.groupEnd();
    }

    // insert/update the embeddings and return
    
    // const docs = chunks.map(chunk => new Document({ pageContent: chunk.text, metadata: { source: message.host, index: chunk.index } }));
    console.groupCollapsed("Adding/updating", chunks.length, "chunks");
    console.time("Elapsed");
    // await pcStore.addDocuments(docs);
    await addToIndex(pcIndex, chunks.slice(0,M), ids);
    console.timeEnd("Elapsed");
    console.groupEnd();
  });
});

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

  await index.deleteMany(ids || []);
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

// ------------------------------

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
