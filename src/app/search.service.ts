// Angular service providing search functionality

// 2024-06-09 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Injectable } from "@angular/core";

import { Bookmark } from "../retriever";

import { sendChunkedMessage } from "ext-send-chunked-message";

@Injectable({
  providedIn: "root",
})
export class SearchService {
  del(id: string): void {
    // console.log('SearchService: Deleting bookmark:', id);

    // note: the deletion is performed by the service worker not here

    const msg = { type: "del-bookmark", payload: id };

    // send msg to the service worker
    chrome.runtime.sendMessage(msg);
  }

  async search(query: string): Promise<any[]> {
    // console.log('SearchService: Searching for:', query);

    // note: the search is performed by the service worker not here

    const msg = { type: "search", payload: query };

    return new Promise((resolve, reject) => {
      // send msg to the service worker
      chrome.runtime.sendMessage(msg).then((response) => {
        switch (response.type) {
          case "result":
            // parse response from the service worker
            // console.log('SearchService: Recieved response:', response);
            const results: Bookmark[] = response.payload;

            const mapped = results
              .filter((result: any) => result.metadata)
              .map((result: any) => ({
                title: result.metadata["title"],
                url: result.metadata["href"],
                summary: result.pageContent,
                visits: "visits" in result.metadata
                  ? result.metadata["visits"]
                  : [],
                nrVectors: "nrVectors" in result.metadata
                  ? result.metadata["nrVectors"]
                  : 99,
                id: result.id,
              }));

            // semantic search results
            resolve(mapped);
            
            break;
          case "error":
            reject(response.payload as Error); // pass error down the chain...?

            break;
          default:
            reject(new Error("Unexpected response from service worker."));

            break;
        }
      });
    });
  }

  async dump(): Promise<string> {
    console.log("SearchService: Dumping history.");

    // get history (as json string) from the service worker

    const msg = { type: "dump-history", payload: {} };

    // send msg to the service worker
    // return chrome.runtime.sendMessage(msg).then((response) => {
    return sendChunkedMessage(msg).then((response: any) => {
      if (response.type !== "history") {
        throw new Error("Unexpected response from service worker.");
      }

      const json: string = response.payload;

      return json;
    });
  }

  async load(json: string): Promise<void> {
    console.log("SearchService: Loading history.");

    // pass history (as json string) to the service worker

    const msg = { type: "load-history", payload: json };

    // send msg to the service worker
    // return chrome.runtime.sendMessage(msg);
    return sendChunkedMessage(msg);
  }

  async indexStats(): Promise<{ vectorCount: number }> {
    const msg = { type: "index-stats", payload: {} };

    return chrome.runtime.sendMessage(msg).then((response) => {
      if (!response || response.type !== "result") {
        console.warn("indexStats: unexpected response", response);
        return { vectorCount: 0 };
      }
      return response.payload as { vectorCount: number };
    });
  }
 
  async getMeta(): Promise<Record<string, any>> {
    return chrome.runtime.sendMessage({ type: "get-meta" }).then((response) => {
      if (!response || response.type !== "result") {
        return {};
      }
      return response.payload as Record<string, any>;
    });
  }

  async setMeta(fields: Record<string, any>): Promise<void> {
    return chrome.runtime.sendMessage({ type: "set-meta", payload: fields }).then((response) => {
      if (!response || response.type !== "result") {
        throw new Error("Unexpected response from service worker.");
      }
    });
  }

  constructor() {}
}
