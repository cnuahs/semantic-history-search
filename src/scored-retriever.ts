// ScoredParentDocumentRetriever - extends ParentDocumentRetriever with:
//   - similarity threshold filtering
//   - vector count tracking in PouchDB (via DocStoreWithUpdate.update())
//   - mean of top-K child score aggregation (topK, default 3)
//   - BM25-style length normalisation (b, default 0.5)

// 2026-03-15 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Document } from "@langchain/core/documents";
import { ParentDocumentRetriever } from "@langchain/classic/retrievers/parent_document";
import { DocStoreWithUpdate, InMemoryLocalStore } from "./retriever";

function isUpdatable(store: any): store is DocStoreWithUpdate {
  return typeof store.update === 'function';
}

function isInMemoryLocalStore(store: any): store is InMemoryLocalStore {
  return store instanceof InMemoryLocalStore;
}

export class ScoredParentDocumentRetriever extends ParentDocumentRetriever {
  // minimum similarity score for a child document to be considered relevant
  // default 0 = no filtering (default behaviour)
  similarityThreshold: number = 0;

  // number of top child scores to average per parent document
  // topK=1 reduces to the original best child score behaviour
  topK: number = 1;

  // BM25-style length normalisation parameter
  // b=0 disables length normalisation (original behaviour)
  // b=1 full normalisation by document length relative to corpus average
  b: number = 0.0;

  constructor(fields: ConstructorParameters<typeof ParentDocumentRetriever>[0] & {
    similarityThreshold?: number;
    topK?: number;
    b?: number;
  }) {
    super(fields);
    this.similarityThreshold = fields.similarityThreshold ?? 0;
    this.topK = fields.topK ?? 3;
    this.b = fields.b ?? 0.5;
  }

  override async _getRelevantDocuments(query: string): Promise<Document[]> {
    // get child docs with similarity scores
    const childDocsWithScores = await this.vectorstore
      .similaritySearchWithScore(query, this.childK);

    // filter by threshold and accumulate all child scores per parent doc
    const parentScores = new Map<string, number[]>();

    for (const [doc, score] of childDocsWithScores) {
      if (score < this.similarityThreshold) continue;

      const parentId = doc.metadata[this.idKey];
      if (!parentId) continue;

      const scores = parentScores.get(parentId) ?? [];
      scores.push(score);
      parentScores.set(parentId, scores);
    }

    // compute avgNrVectors across all indexed bookmarks in docstore
    // (used for BM25-style length normalisation)
    let avgNrVectors = 1; // fallback: no normalisation if docstore is not InMemoryLocalStore
    if (isInMemoryLocalStore(this.docstore)) {
      const indexed = Object.values(this.docstore.store)
        .filter(bmk => bmk.indexed && (bmk.nrVectors ?? 0) > 1);
      if (indexed.length > 0) {
        avgNrVectors = indexed.reduce((sum, bmk) => sum + (bmk.nrVectors ?? 0), 0) / indexed.length;
      }
    }

    // for each parent doc, sort child scores descending, take top-K, compute
    // mean, then apply BM25-style length normalisation:
    //   normalisedScore = meanTopK / (1 - b + b * (nrVectors / avgNrVectors))
    const normalisedScores = new Map<string, number>();

    for (const [parentId, scores] of parentScores.entries()) {
      scores.sort((a, b) => b - a);
      const topK = scores.slice(0, this.topK);
      const meanTopK = topK.reduce((sum, s) => sum + s, 0) / topK.length;

      let nrVectors = 1; // fallback: no length penalty if nrVectors unavailable
      if (isInMemoryLocalStore(this.docstore)) {
        nrVectors = this.docstore.store[parentId]?.nrVectors ?? 1;
      }

      const lengthNorm = 1 - this.b + this.b * (nrVectors / avgNrVectors);
      normalisedScores.set(parentId, meanTopK / lengthNorm);
    }

    // sort parent doc ids by normalised score (descending)
    const parentDocIds = [...normalisedScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    // retrieve parent docs from docstore
    const parentDocs = (await this.docstore.mget(parentDocIds))
      .filter((doc: Document | undefined) => doc !== undefined);

    return parentDocs.slice(0, this.parentK);
  }

  override async _storeDocuments(
    parentDoc: Record<string, Document>,
    childDocs: Document[],
    addToDocstore: boolean,
  ): Promise<void> {
    // call base class to handle vector store write
    await super._storeDocuments(parentDoc, childDocs, addToDocstore);

    // record vector count if docstore supports update()
    const parentDocId = Object.keys(parentDoc)[0];
    if (isUpdatable(this.docstore)) {
      const existing = (this.docstore as any).store?.[parentDocId];
      const nrVectors = (existing as any)?.metadata?.nrVectors ?? 0;
      await this.docstore.update(parentDocId, { nrVectors: nrVectors + childDocs.length, indexed: true });
    }
  }
}
