import { Injectable } from '@angular/core';

import { Bookmark } from '../retriever';

@Injectable({
  providedIn: 'root'
})
export class SearchService {

  async search(query: string): Promise<any[]> {
    // console.log('SearchService: Searching for:', query);

    // note: the search is performed by the service worker not here
    
    const msg = { type: "search", payload: query };
    
    return new Promise((resolve, _reject) => {
      // send msg to the service worker
      chrome.runtime.sendMessage(msg)
      .then((response) => {
        // parse response from the service worker
        // console.log('SearchService: Recieved response:', response);
        const results: Bookmark[] = response.payload;
        resolve(results
        .map((result: any) => result.metadata ? {
          title: result.metadata["title"],
          url: result.metadata["href"],
          summary: result.pageContent,
          date: new Date(),
          id: result.id
        } : null)
        .filter((result: any): result is { title: string; url: string; summary: string; date: Date; id: string } => result !== null));
      });
    });    

  }

  constructor() { }
}
