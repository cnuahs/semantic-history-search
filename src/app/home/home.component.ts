import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";

import { SearchService } from "../search.service";

import { ResultsComponent } from "../results/results.component";

@Component({
  selector: "app-home",
  imports: [FormsModule, RouterLink, ResultsComponent],
  templateUrl: "./home.component.html",
  styleUrl: "./home.component.css",
})
export class HomeComponent implements OnInit {
  query: string = "";
  results: any[] = [];
  mode: 'history' | 'search' = 'history';

  constructor(private searchService: SearchService) {
    // injects SearchService as this.searchService
  }

  ngOnInit() {
    this.loadHistory();
  }

  private loadHistory() {
    this.mode = 'history';
    this.searchService
      .search('')
      .then((results) => {
        this.results = results;
      })
      .catch((err) => {
        console.error("HomeComponent.loadHistory()", err);
      });
  }

  handleSearch() {
    if (this.query === '') {
      this.loadHistory();
      return;
    }

    this.mode = 'search';
    this.searchService
      .search(this.query)
      .then((results) => {
        this.results = results;
      })
      .catch((err) => {
        console.error("HomeComponent.handleSearch()", err);
      });
  }
}
