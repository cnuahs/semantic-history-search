import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from "@angular/router";
import { DatePipe, DecimalPipe } from "@angular/common";

import { SearchService } from "../search.service";
import { SettingsService } from "../settings.service";

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, FormsModule, DatePipe, DecimalPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent {
// summary stats
  nrBookmarks: number = 0;
  nrVisits: number = 0;
  oldestVisit: number = 0;

  // frecency
  readonly halfLifeDays: number = 30;
  scores: { id: string, score: number }[] = [];

  // purge threshold
  purgeThreshold: number = 0.1;
  get nrFlagged(): number {
    return this.scores.filter(s => s.score < this.purgeThreshold).length;
  }

  get maxBinCount(): number {
    return Math.max(...this.bins.map(b => b.count));
  }

  get minScore(): number {
    return Math.min(...this.scores.map(s => s.score));
  }

  get maxScore(): number {
    return Math.max(...this.scores.map(s => s.score));
  }

  get logMinScore(): number { return Math.log10(Math.max(this.minScore, 1e-6)); }
  get logMaxScore(): number { return Math.log10(this.maxScore); }

  get logThreshold(): number { return Math.log10(Math.max(this.purgeThreshold, 1e-6)); }
  set logThreshold(val: number) { this.purgeThreshold = Math.pow(10, val); }

  get thresholdX(): number {
    return ((this.logThreshold - this.logMinScore) / (this.logMaxScore - this.logMinScore)) * 720;
  }

  // histogram
  bins: { x0: number, x1: number, count: number }[] = [];
  readonly nrBins: number = 40;

  isLoading: boolean = true;

  constructor(
    private searchService: SearchService,
    private settingsService: SettingsService,
  ) {}

  ngOnInit() {
    this.settingsService.get('purge-threshold').then((settings) => {
      const setting = Array.isArray(settings) ? settings[0] : settings;
      this.purgeThreshold = Number(setting?.value) || 0.1;
    });

    this.searchService.search('').then((bookmarks) => {
      this.nrBookmarks = bookmarks.length;
      this.nrVisits = bookmarks.reduce((n, b) => n + b.visits.length, 0);
      this.oldestVisit = Math.min(...bookmarks.flatMap((b: any) => b.visits));

      this.scores = bookmarks.map((b: any) => ({ id: b.id, score: this.frecency(b.visits) }));

      this.buildHistogram();
      this.isLoading = false;
    });
  }

  // calculate frecency score — exponential decay over visits
  // lambda controls rate of decay, where lambda = ln(2) / halfLife <-- score halves in halfLife days
  private frecency(visits: number[], halfLifeDays: number = 30): number {
    const lambda = Math.log(2) / halfLifeDays;
    const now = Date.now();
    return visits.reduce((score, visit) => {
      const daysAgo = (now - visit) / (1000 * 60 * 60 * 24);
      return score + Math.exp(-lambda * daysAgo);
    }, 0);
  }

  private buildHistogram() {
    const minScore = this.minScore;
    const maxScore = this.maxScore;

    // log scale bins
    const logMin = Math.log10(Math.max(minScore, 1e-6));
    const logMax = Math.log10(maxScore);
    const binWidth = (logMax - logMin) / this.nrBins;

    this.bins = Array.from({ length: this.nrBins }, (_, i) => ({
      x0: Math.pow(10, logMin + i * binWidth),
      x1: Math.pow(10, logMin + (i + 1) * binWidth),
      count: 0,
    }));

    this.scores.forEach(({ score }) => {
      const logScore = Math.log10(Math.max(score, 1e-6));
      const i = Math.min(
        Math.floor((logScore - logMin) / binWidth),
        this.nrBins - 1
      );
      this.bins[i].count++;
    });
  }

  savePurgeThreshold() {
    this.settingsService.get().then((settings) => {
      const all = Array.isArray(settings) ? settings : [settings];
      const setting = all.find(s => s.name === 'purge-threshold');
      if (setting) {
        setting.value = this.purgeThreshold;
      }
      this.settingsService.set(all);
    });
  }

  purge() {
    const toDelete = this.scores.filter(s => s.score < this.purgeThreshold);

    toDelete.forEach(({ id }) => this.searchService.del(id));

    // update local state
    this.scores = this.scores.filter(s => s.score >= this.purgeThreshold);
    this.nrBookmarks -= toDelete.length;
    this.buildHistogram();
  }

}
