import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class SearchService {
  private results = [
      { title: 'Result 1', url: 'https://www.no-domain.com/', summary: '', date: new Date(), id: 1 },
      { title: 'Result 2', url: 'https://www.no-domain.com/', summary: '', date: new Date(), id: 2 },
      { title: 'Result 3', url: 'https://www.no-domain.com/', summary: '', date: new Date(), id: 3 },
      { title: 'Result 4', url: 'https://www.no-domain.com/', summary: '', date: new Date(), id: 4 },
      { title: 'Result 5', url: 'https://www.no-domain.com/', summary: '', date: new Date(), id: 5 },
      { title: 'Result 6', url: 'https://www.no-domain.com/', summary: '', date: new Date(), id: 6 },
      { title: 'Result 7', url: 'https://www.no-domain.com/', summary: '', date: new Date(), id: 7 },
      { title: 'Result 8', url: 'https://www.no-domain.com/', summary: '', date: new Date(), id: 8 },
      { title: 'Result 9', url: 'https://www.no-domain.com/', summary: '', date: new Date(), id: 9 },
      { title: 'Result 10',url: 'https://www.no-domain.com/', summary: '', date: new Date(), id: 10 }
    ];

  query(query: string): any[] {
    let n = Math.floor(Math.random() * this.results.length);
    return this.results.slice(0,n);
  }

  constructor() { }
}
