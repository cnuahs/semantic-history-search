import { Injectable } from '@angular/core';

import { Bookmark } from '../retriever';

@Injectable({
  providedIn: 'root'
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
      chrome.runtime.sendMessage(msg)
      .then((response) => {
        switch (response.type) {
          case "result":
            // parse response from the service worker
            // console.log('SearchService: Recieved response:', response);
            const results: Bookmark[] = response.payload;
            resolve(results
            .map((result: any) => result.metadata ? {
              title: result.metadata["title"],
              url: result.metadata["href"],
              summary: result.pageContent,
              count: "count" in result.metadata ? result.metadata["count"] : 0,
              date: "date" in result.metadata ? result.metadata["date"] : 0, // 0 = midnight, 1st Jan 1970
              id: result.id
            } : null)
            .filter((result: any): result is { title: string; url: string; summary: string; count: number, date: number; id: string } => result !== null));

            break;
          case "error":
            reject(response.payload as Error); // pass error down the chain...?

            break;
          default:
            reject(new Error('Unexpected response from service worker.'));

            break;
        }
      });
    });    

  }

  constructor() { }
}
