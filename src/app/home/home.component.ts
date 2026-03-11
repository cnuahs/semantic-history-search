import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";

import { SearchService } from "../search.service";
import { SettingsService } from "../settings.service";

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

  nrTotal: number = 0; // total number of entries in our history

  historyLimitDays: number = 90; // limit (in days) on history displayed in the history view (configurable via settings)

  isLoading: boolean = true;

  constructor(
    private searchService: SearchService, // injects SearchService as this.searchService
    private settingsService: SettingsService, // injects SettingsService as this.settingsService
  ) {}

  ngOnInit() {
    this.settingsService.get('history-limit-days').then((settings) => {
      const setting = Array.isArray(settings) ? settings[0] : settings;
      this.historyLimitDays = Number(setting?.value) || 90;
      this.loadHistory();
    });
    this.searchService.count().then((n) => {
      this.nrTotal = n;
    });
  }

  private loadHistory() {
    this.isLoading = true;

    this.mode = 'history';

    const limit = this.historyLimitDays * 24 * 60 * 60 * 1000;
    this.searchService
      .search('')
      .then((results) => {
        this.results = results
          .filter((item) => item.visited >= Date.now() - limit)
          .sort((a, b) => b.visited - a.visited);
        this.isLoading = false;
      })
      .catch((err) => {
        console.error("HomeComponent.loadHistory()", err);
        this.isLoading = false;
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
