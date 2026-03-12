import { Component, OnInit, OnDestroy } from "@angular/core";
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
export class DashboardComponent implements OnInit, OnDestroy {
  bookmarks: any[] = [];

  // summary stats
  get nrBookmarks(): number { return this.bookmarks.length; }
  get nrVisits(): number { return this.bookmarks.reduce((n, b) => n + b.visits.length, 0); }
  get oldestVisit(): number { return Math.min(...this.bookmarks.flatMap((b: any) => b.visits)); }

  // frecency
  halfLifeDays: number = 30;
  scores: { id: string, score: number }[] = [];

  // purge threshold
  purgeThreshold: number = 0.1;

  get nrFlagged(): number {
    return this.scores.filter(s => s.score < this.purgeThreshold).length;
  }

  // histogram
  bins: { x0: number, x1: number, count: number }[] = [];
  readonly nrBins: number = 40;

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

  isLoading: boolean = true;

  constructor(
    private searchService: SearchService,
    private settingsService: SettingsService,
  ) {}

  ngOnInit() {
    Promise.all([
      this.settingsService.get('purge-threshold'),
      this.settingsService.get('frecency-half-life'),
    ]).then(([purgeSettings, halfLifeSettings]) => {
      const purgeSetting = Array.isArray(purgeSettings) ? purgeSettings[0] : purgeSettings;
      this.purgeThreshold = Number(purgeSetting?.value) || 0.1;

      const halfLifeSetting = Array.isArray(halfLifeSettings) ? halfLifeSettings[0] : halfLifeSettings;
      this.halfLifeDays = Number(halfLifeSetting?.value) || 30;

      return this.searchService.search('');
    }).then((bookmarks: any[]) => {
      this.bookmarks = bookmarks;
      this.buildHistogram();
      this.isLoading = false;
    });
  }

  ngOnDestroy() {
    this.saveSettings();
  }

  private frecency(visits: number[]): number {
    const lambda = Math.log(2) / this.halfLifeDays;
    const now = Date.now();
    return visits.reduce((score, visit) => {
      const daysAgo = (now - visit) / (1000 * 60 * 60 * 24);
      return score + Math.exp(-lambda * daysAgo);
    }, 0);
  }

  private computeScores() {
    this.scores = this.bookmarks.map((b: any) => ({
      id: b.id,
      score: this.frecency(b.visits),
    }));
  }

  buildHistogram() {
    this.computeScores()

    const logMin = this.logMinScore;
    const logMax = this.logMaxScore;
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

  purge() {
    const toDelete = this.scores.filter(s => s.score < this.purgeThreshold);
    toDelete.forEach(({ id }) => this.searchService.del(id));
    const deleteIds = new Set(toDelete.map(s => s.id));
    this.bookmarks = this.bookmarks.filter((b: any) => !deleteIds.has(b.id));
    this.buildHistogram();
  }

  private saveSettings() {
    this.settingsService.get().then((settings) => {
      const all = Array.isArray(settings) ? settings : [settings];

      const halfLife = all.find(s => s.name === 'frecency-half-life');
      if (halfLife) halfLife.value = this.halfLifeDays;

      const purge = all.find(s => s.name === 'purge-threshold');
      if (purge) purge.value = this.purgeThreshold;

      this.settingsService.set(all);
    });
  }
}
