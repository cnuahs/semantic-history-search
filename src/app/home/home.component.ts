import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { SearchService } from '../search.service';

import { ResultsComponent } from '../results/results.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [FormsModule, RouterLink, ResultsComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent {
  query: string = '';
  results: any[] = [];

  constructor(private searchService: SearchService) {
    // injects SearchService as this.searchService
  }

  handleSearch() {
    // perform the search via the search service
    this.searchService.search(this.query).then((results) => {
      this.results = results;
    });
  }
}
