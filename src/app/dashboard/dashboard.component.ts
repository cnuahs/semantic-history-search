import { Component, OnInit, OnDestroy, ViewChild, ElementRef } from "@angular/core";
import { FormsModule } from '@angular/forms';
import { RouterLink } from "@angular/router";
import { DatePipe, DecimalPipe } from "@angular/common";

import { SearchService } from "../search.service";
import { SettingsService } from "../settings.service";

import * as d3 from 'd3';

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, FormsModule, DatePipe, DecimalPipe],
  templateUrl: './dashboard.component.html',
  styleUrl: './dashboard.component.css',
})
export class DashboardComponent implements OnInit, OnDestroy {
  version: string = '';

  bookmarks: any[] = [];

  // summary stats
  get nrBookmarks(): number { return this.bookmarks.length; }
  get nrVisits(): number { return this.bookmarks.reduce((n, b) => n + b.visits.length, 0); }
  get oldestVisit(): number { return Math.min(...this.bookmarks.flatMap((b: any) => b.visits)); }

  // growth
  growth: { t: number, n: number }[] = [];
  private _growthCurveEl!: ElementRef;

  @ViewChild('growthCurve') set growthCurveEl(el: ElementRef) {
    if (el) {
      this._growthCurveEl = el;
      if (this.growth.length > 0) {
        this.buildGrowthCurve();
      }
    }
  }

  private _histogramEl!: ElementRef;

  @ViewChild('histogram') set histogramEl(el: ElementRef) {
    if (el) {
      this._histogramEl = el;
      if (this.scores.length > 0) {
        this.buildHistogram();
      }
    }
  }

  // frecency
  halfLifeDays: number = 30;
  scores: { id: string, score: number }[] = [];

  // purge threshold
  purgeThreshold: number = 0.1;

  get nrFlagged(): number {
    return this.scores.filter(s => s.score < this.purgeThreshold).length;
  }

  // histogram

  get logThreshold(): number { return Math.log10(Math.max(this.purgeThreshold, 1e-6)); }
  set logThreshold(val: number) { this.purgeThreshold = Math.pow(10, val); }

  get minScore(): number { return Math.min(...this.scores.map(s => s.score)); }
  get maxScore(): number { return Math.max(...this.scores.map(s => s.score)); }
  get logMinScore(): number { return Math.round(Math.log10(Math.max(this.minScore, 1e-6)) * 1e3) / 1e3; } // rounded to 3 decimal places
  get logMaxScore(): number { return Math.round(Math.log10(this.maxScore) * 1e3) / 1e3; } // round to 3 decimal places

  isLoading: boolean = true;

  constructor(
    private searchService: SearchService,
    private settingsService: SettingsService,
  ) {}

  ngOnInit() {
    this.version = chrome.runtime.getManifest().version;
    
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
      this.buildGrowthCurve();
      this.buildHistogram();
      this.isLoading = false;
    });
  }

  ngOnDestroy() {
    this.saveSettings();
  }

  computeGrowth() {
    this.growth = [...this.bookmarks]
      .sort((a, b) => a.visits[0] - b.visits[0])
      .map((b, i) => ({ t: b.visits[0], n: i + 1 }));
  }

  buildGrowthCurve() {
    this.computeGrowth();

    if (!this._growthCurveEl) return;
    const el = this._growthCurveEl.nativeElement;

    const margin = { top: 10, right: 10, bottom: 20, left: 40 };
    const width = el.clientWidth - margin.left - margin.right;
    const height = 160 - margin.top - margin.bottom;

    // clear previous render
    d3.select(el).selectAll('*').remove();

    const svg = d3.select(el)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // scales
    const xScale = d3.scaleTime()
      .domain([new Date(this.growth[0].t), new Date()])
      .range([0, width]);

    const yScale = d3.scaleLinear()
      .domain([0, this.nrBookmarks])
      .range([height, 0]);

    // axes
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(xScale).ticks(5))
      .attr('color', '#cbd5e1'); // slate-300

    svg.append('g')
      .call(d3.axisLeft(yScale).ticks(4))
      .attr('color', '#cbd5e1');

    // line
    const line = d3.line<{ t: number, n: number }>()
      .x(p => xScale(new Date(p.t)))
      .y(p => yScale(p.n));

    svg.append('path')
      .datum(this.growth)
      .attr('fill', 'none')
      .attr('stroke', '#22d3ee')
      .attr('stroke-width', 1.5)
      .attr('d', line);
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
    this.computeScores();

    if (!this._histogramEl) return;

    const el = this._histogramEl.nativeElement;
    const margin = { top: 10, right: 10, bottom: 20, left: 40 };
    const width = el.clientWidth - margin.left - margin.right;
    const height = 160 - margin.top - margin.bottom;

    d3.select(el).selectAll('*').remove();

    const svg = d3.select(el)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const scores = this.scores.map(s => s.score);
    const minScore = Math.min(...scores);
    const maxScore = Math.max(...scores);

    // log scale
    const xScale = d3.scaleLog()
      .domain([Math.max(minScore, 1e-6), maxScore])
      .range([0, width]);

    // bin the scores
    const thresholds = d3.range(40).map(i =>
      Math.pow(10, Math.log10(Math.max(minScore, 1e-6)) + i * (Math.log10(maxScore) - Math.log10(Math.max(minScore, 1e-6))) / 40)
    );

    const binner = d3.bin()
      .domain([Math.max(minScore, 1e-6), maxScore])
      .thresholds(thresholds);

    const bins = binner(scores);

    const yScale = d3.scaleLinear()
      .domain([0, d3.max(bins, b => b.length) as number])
      .range([height, 0]);

    // axes — ticks at powers of 10 within the domain
    const tickValues = d3.range(
      Math.floor(this.logMinScore),
      Math.ceil(this.logMaxScore) + 1
    ).map(i => Math.pow(10, i));

    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(xScale)
        .tickValues(tickValues)
        .tickFormat(d => {
          const v = d as number;
          if (v >= 1) return d3.format('.0f')(v);
          if (v >= 0.1) return d3.format('.1f')(v);
          if (v >= 0.01) return d3.format('.2f')(v);
          return d3.format('.0e')(v);
        })
      )
      .attr('color', '#cbd5e1');

    svg.append('g')
      .call(d3.axisLeft(yScale).ticks(4))
      .attr('color', '#cbd5e1');

    // bars
    svg.selectAll('rect')
      .data(bins)
      .enter()
      .append('rect')
      .attr('x', b => xScale(Math.max(b.x0 as number, 1e-6)))
      .attr('width', b => Math.max(0, xScale(b.x1 as number) - xScale(Math.max(b.x0 as number, 1e-6)) - 1))
      .attr('y', b => yScale(b.length))
      .attr('height', b => height - yScale(b.length))
      .attr('fill', b => (b.x0 as number) < this.purgeThreshold ? '#f87171' : '#22d3ee');

    // threshold marker
    svg.append('line')
      .attr('x1', xScale(Math.max(this.purgeThreshold, 1e-6)))
      .attr('x2', xScale(Math.max(this.purgeThreshold, 1e-6)))
      .attr('y1', 0)
      .attr('y2', height)
      .attr('stroke', '#ef4444')
      .attr('stroke-width', 1.5)
      .attr('stroke-dasharray', '4,2');
  }

  purge() {
    const toDelete = this.scores.filter(s => s.score < this.purgeThreshold);
    toDelete.forEach(({ id }) => this.searchService.del(id));
    const deleteIds = new Set(toDelete.map(s => s.id));
    this.bookmarks = this.bookmarks.filter((b: any) => !deleteIds.has(b.id));
    this.buildGrowthCurve();
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
