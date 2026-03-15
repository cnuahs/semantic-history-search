// ScoredParentDocumentRetriever - extends ParentDocumentRetriever with:
//   - similarity threshold filtering
//   - vector count tracking in PouchDB (via DocStoreWithUpdate.update())

// 2026-03-15 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Document } from "@langchain/core/documents";
import { ParentDocumentRetriever } from "@langchain/classic/retrievers/parent_document";
import { DocStoreWithUpdate } from "./retriever";

function isUpdatable(store: any): store is DocStoreWithUpdate {
  return typeof store.update === 'function';
}

export class ScoredParentDocumentRetriever extends ParentDocumentRetriever {
  // minimum similarity score for a child document to be considered relevant
  // default 0 = no filtering (default behaviour)
  similarityThreshold: number = 0;

  override async _getRelevantDocuments(query: string): Promise<Document[]> {
    // get child docs with similarity scores
    const childDocsWithScores = await this.vectorstore
      .similaritySearchWithScore(query, this.childK);

    // filter by threshold and extract unique parent doc ids
    // and best child score per parent doc
    const parentScores = new Map<string, number>();

    for (const [doc, score] of childDocsWithScores) {
      if (score < this.similarityThreshold) continue;

      const parentId = doc.metadata[this.idKey];
      if (!parentId) continue;

      const best = parentScores.get(parentId) ?? 0;
      if (score > best) parentScores.set(parentId, score);
    }

    // sort parent doc ids by best child score (descending)
    const parentDocIds = [...parentScores.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id);

    // retrieve parent docs from docstore
    const parentDocs = (await this.docstore.mget(parentDocIds))
      .filter((doc: Uint8Array | undefined) => doc !== undefined);

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
      await this.docstore.update(parentDocId, { vectorCount: childDocs.length });
    }
  }
}
