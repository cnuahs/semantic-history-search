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

  historyLimitDays: number = 90; // limit (in days) on history displayed in the history view (configurable via settings)

  showUnindexed: boolean = false; // show only indexed bookmarks by default

  isLoading: boolean = true;

  private binFn(timestamp: number): string {
    const age = Date.now() - timestamp;
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (age < hour)       return 'Last Hour';
    if (age < day)        return 'Today';
    if (age < 2 * day)    return 'Yesterday';
    if (age < 7 * day)    return 'This Week';
    if (age < 30 * day)   return 'This Month';
    return 'Older';
  }

  constructor(
    private searchService: SearchService, // injects SearchService as this.searchService
    private settingsService: SettingsService, // injects SettingsService as this.settingsService
  ) {}

  ngOnInit() {
    this.settingsService.get('history-limit-days').then((settings) => {
      const setting = Array.isArray(settings) ? settings[0] : settings;
      this.historyLimitDays = Number(setting?.value) || 90;
      this.handleSearch(); // fetch history
    });
  }

  private loadHistory(): Promise<void> {
    const cutoff = Date.now() - (this.historyLimitDays * 24 * 60 * 60 * 1000);

    return this.searchService
      .search('')
      .then((bookmarks) => {
        this.results = bookmarks
          .filter((item: any) => this.showUnindexed || item.indexed)
          .flatMap((item: any) =>
            item.visits
              .filter((timestamp: number) => timestamp >= cutoff)
              .map((timestamp: number, i: number) => ({
                ...item,
                visited: timestamp,
                bin: this.binFn(timestamp),
                key: `${item.id}-${timestamp}-${i}`,
              }))
          )
          .sort((a: any, b: any) => b.visited - a.visited);
      })
      .catch((err) => {
        console.error("HomeComponent.loadHistory()", err);
      });
  }

  handleSearch() {
    this.isLoading = true;

    this.results = [];  

    this.mode = this.query === '' ? 'history' : 'search';

    const done = () => { this.isLoading = false; };

    if (this.query === '') {
      this.loadHistory().finally(done);
      return;
    }

    this.searchService
      .search(this.query)
      .then((results) => {
        this.results = results;
      })
      .catch((err) => {
        console.error("HomeComponent.handleSearch()", err);
      })
      .finally(done);
  }

}
