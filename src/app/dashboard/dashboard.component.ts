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

  lastPurgeDate: number | null = null;
  
  // summary stats
  get nrBookmarks(): number { return this.bookmarks.length; }
  get nrVisits(): number { return this.bookmarks.reduce((n, b) => n + b.visits.length, 0); }
  get oldestVisit(): number { return Math.min(...this.bookmarks.flatMap((b: any) => b.visits)); }
  get localVectorCount(): number { return this.bookmarks.reduce((n, b) => n + (b.nrVectors ?? 0), 0); }

  get vectorDelta(): number { return this.vectorCount - this.localVectorCount; }

  get vectorDeltaLabel(): string {
    const d = this.vectorDelta;
    const abs = Math.abs(d);
    const prefix = d > 0 ? '+' : '-';
    if (abs >= 1000) {
      return `${prefix}${Math.round(abs / 1000)}k`;
    }
    return `${prefix}${abs}`;
  }

  vectorCount: number = 0; // vector database/store size

  storageSizeMB: number = 0;

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

  private _vectorHistogramEl!: ElementRef;

  @ViewChild('vectorHistogram') set vectorHistogramEl(el: ElementRef) {
    this._vectorHistogramEl = el;
    if (el) this.buildVectorHistogram();
  }

  // frecency
  indexedHalfLifeDays: number = 30;
  unindexedHalfLifeDays: number = 14;
  scores: { id: string, score: number, indexed: boolean }[] = [];

  // purge threshold
  purgeThreshold: number = 0.1;

  get nrFlagged(): number {
    return this.scores.filter(s => s.score < this.purgeThreshold).length;
  }

  get nrIndexed(): number {
    return this.bookmarks.filter((b: any) => b.indexed).length;
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
      this.settingsService.get('indexed-half-life'),
      this.settingsService.get('unindexed-half-life'),
    ]).then(([purgeSettings, halfLifeSettings, unindexedHalfLifeSettings]) => {
      const purgeSetting = Array.isArray(purgeSettings) ? purgeSettings[0] : purgeSettings;
      this.purgeThreshold = Number(purgeSetting?.value) || 0.1;

      const indexedHalfLifeSetting = Array.isArray(halfLifeSettings) ? halfLifeSettings[0] : halfLifeSettings;
      this.indexedHalfLifeDays = Number(indexedHalfLifeSetting?.value) || 30;

      const unindexedHalfLifeSetting = Array.isArray(unindexedHalfLifeSettings) ? unindexedHalfLifeSettings[0] : unindexedHalfLifeSettings;
      this.unindexedHalfLifeDays = Number(unindexedHalfLifeSetting?.value) || 14;

      return this.searchService.search('');
    }).then((bookmarks: any[]) => {
      this.bookmarks = bookmarks;
      this.buildGrowthCurve();
      this.buildHistogram();
      this.buildVectorHistogram();
      this.isLoading = false;
    });

    this.searchService.indexStats().then((stats) => {
      this.vectorCount = stats.vectorCount;
    });

    // get estimate of local storage usage
    navigator.storage.estimate().then((estimate) => {
      this.storageSizeMB = (estimate.usage ?? 0) / (1024 * 1024);
    });

    this.searchService.getMeta().then((meta) => {
      this.lastPurgeDate = meta['lastPurgeDate'] ?? null;
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

  private kde(visits: number[], bandwidth: number, points: number[], normalise: boolean = true): number[] {
    const values = points.map(t =>
      visits.reduce((sum, v) => {
        const z = (t - v) / bandwidth;
        return sum + Math.exp(-0.5 * z * z);
      }, 0)
    );
    if (!normalise) return values;
    const max = Math.max(...values);
    return max > 0 ? values.map(v => v / max) : values;
  }

  buildGrowthCurve() {
    this.computeGrowth();

    if (!this._growthCurveEl) return;

    const el = this._growthCurveEl.nativeElement;
    const margin = { top: 10, right: 10, bottom: 20, left: 40 };
    const width = el.clientWidth - margin.left - margin.right;
    const height = 160 - margin.top - margin.bottom;

    // colours
    const colours = {
      growthLine: '#22d3ee',   // cyan-400
      kdeAll: '#f1f5f9',       // slate-100
      // kdeFirst: '#e2e8f0',     // slate-200
      kdeFirst: '#94a3b8',     // slate-400 (for stroked variant)
      axes: '#cbd5e1',         // slate-300
    };

    // clear previous render
    d3.select(el).selectAll('*').remove();

    const svg = d3.select(el)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    const start = this.growth[0].t;
    const end = Date.now();

    // scales
    const xScale = d3.scaleTime()
      .domain([new Date(start), new Date(end)])
      .range([0, width]);

    const yScale = d3.scaleLinear()
      .domain([0, this.nrBookmarks])
      .range([height, 0]);

    // kde evaluation points — 200 evenly spaced
    const nPoints = 200;
    const points = d3.range(nPoints).map(i => start + (i / (nPoints - 1)) * (end - start));

    // bandwidth ~ 1 week (7 days) in ms
    const bandwidth = 7 * 24 * 60 * 60 * 1000;

    // all visits
    const allVisits = this.bookmarks.flatMap((b: any) => b.visits);
    var kdeAll = this.kde(allVisits, bandwidth, points, false); // unnormalized

    // first visits only
    const firstVisits = this.bookmarks.map((b: any) => b.visits[0]);
    var kdeFirst = this.kde(firstVisits, bandwidth, points, false); // unnormalized

    // normalise both, preserving relative scale
    const max = Math.max(...kdeAll);
    kdeAll = kdeAll.map(v => v / max);
    kdeFirst = kdeFirst.map(v => v / max);

    // kde height — 20% of chart height
    const kdeHeight = height * 0.2;

    // area generator for kde
    const kdeArea = d3.area<number>()
      .x((_, i) => xScale(new Date(points[i])))
      .y0(height)
      .y1((d) => height - d * kdeHeight)
      .curve(d3.curveBasis);

    // draw all-visits kde (light gray)
    svg.append('path')
      .datum(kdeAll)
      .attr('fill', colours.kdeAll)
      .attr('stroke', 'none')
      .attr('d', kdeArea);

    // draw first-visits kde (slightly darker gray)
    // svg.append('path')
    //   .datum(kdeFirst)
    //   .attr('fill', colours.kdeFirst)
    //   .attr('stroke', 'none')
    //   .attr('d', kdeArea);

    // draw first-visits kde (stroke only)
    svg.append('path')
      .datum(kdeFirst)
      .attr('fill', 'none')
      .attr('stroke', colours.kdeFirst)
      .attr('stroke-width', 1)
      .attr('d', kdeArea);

    // axes
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(xScale).ticks(5))
      .attr('color', colours.axes);

    svg.append('g')
      .call(d3.axisLeft(yScale).ticks(4))
      .attr('color', colours.axes);

    // growth line (drawn last so it's on top)
    const line = d3.line<{ t: number, n: number }>()
      .x(p => xScale(new Date(p.t)))
      .y(p => yScale(p.n));

    svg.append('path')
      .datum(this.growth)
      .attr('fill', 'none')
      .attr('stroke', colours.growthLine)
      .attr('stroke-width', 1.5)
      .attr('d', line);
  }

  private frecency(visits: number[], halfLifeDays: number = this.indexedHalfLifeDays): number {
    const lambda = Math.log(2) / halfLifeDays;
    const now = Date.now();
    return visits.reduce((score, visit) => {
      const daysAgo = (now - visit) / (1000 * 60 * 60 * 24);
      return score + Math.exp(-lambda * daysAgo);
    }, 0);
  }

  private computeScores() {
    this.scores = this.bookmarks.map((b: any) => ({
      id: b.id,
      score: this.frecency(b.visits, b.indexed ? this.indexedHalfLifeDays : this.unindexedHalfLifeDays),
      indexed: b.indexed,
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

    const indexedScores = scores.filter((_, i) => this.scores[i].indexed);
    const unindexedScores = scores.filter((_, i) => !this.scores[i].indexed);

    const indexedBins = binner(indexedScores);
    const unindexedBins = binner(unindexedScores);

    const yScale = d3.scaleLinear()
      .domain([0, d3.max([...indexedBins, ...unindexedBins], b => b.length) as number])
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

    // bars — unindexed (slate, drawn first so indexed appears on top)
    svg.selectAll('rect.unindexed')
      .data(unindexedBins)
      .enter()
      .append('rect')
      .attr('class', 'unindexed')
      .attr('x', b => xScale(Math.max(b.x0 as number, 1e-6)))
      .attr('width', b => Math.max(0, xScale(b.x1 as number) - xScale(Math.max(b.x0 as number, 1e-6)) - 1))
      .attr('y', b => yScale(b.length))
      .attr('height', b => height - yScale(b.length))
      .attr('fill', b => (b.x0 as number) < this.purgeThreshold ? '#fca5a5' : '#94a3b8')
      .attr('opacity', 0.7);

    // bars — indexed (cyan, drawn on top)
    svg.selectAll('rect.indexed')
      .data(indexedBins)
      .enter()
      .append('rect')
      .attr('class', 'indexed')
      .attr('x', b => xScale(Math.max(b.x0 as number, 1e-6)))
      .attr('width', b => Math.max(0, xScale(b.x1 as number) - xScale(Math.max(b.x0 as number, 1e-6)) - 1))
      .attr('y', b => yScale(b.length))
      .attr('height', b => height - yScale(b.length))
      .attr('fill', b => (b.x0 as number) < this.purgeThreshold ? '#f87171' : '#22d3ee')
      .attr('opacity', 0.7);

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

  buildVectorHistogram() {
    if (!this._vectorHistogramEl) return;

    const el = this._vectorHistogramEl.nativeElement;
    const margin = { top: 10, right: 10, bottom: 20, left: 40 };
    const width = el.clientWidth - margin.left - margin.right;
    const height = 160 - margin.top - margin.bottom;

    d3.select(el).selectAll('*').remove();

    const svg = d3.select(el)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`);

    // colours
    const colors = {
      nullBar: '#f1f5f9',      // slate-100 — unknown
      bar: '#22d3ee',          // cyan-400 — known
      axes: '#cbd5e1',         // slate-300
    };

    // bin boundaries: null, 1, 2-5, 6-10, 11-50, 51-100, 101-500, 501+
    const binLabels = ['--', '0-1', '2-5', '6-10', '11-50', '51-100', '101-500', '501-1000', '1001+'];
    const binCounts = [0, 0, 0, 0, 0, 0, 0, 0, 0];

    for (const b of this.bookmarks) {
      const n = b.nrVectors;
      if (n === null || n === undefined) binCounts[0]++;
      else if (n <= 1) binCounts[1]++;
      else if (n <= 5) binCounts[2]++;
      else if (n <= 10) binCounts[3]++;
      else if (n <= 50) binCounts[4]++;
      else if (n <= 100) binCounts[5]++;
      else if (n <= 500) binCounts[6]++;
      else if (n <= 1000) binCounts[7]++;
      else binCounts[8]++;
    }

    const xScale = d3.scaleBand()
      .domain(binLabels)
      .range([0, width])
      .padding(0.1);

    const yScale = d3.scaleLinear()
      .domain([0, Math.max(...binCounts)])
      .range([height, 0]);

    // axes
    svg.append('g')
      .attr('transform', `translate(0,${height})`)
      .call(d3.axisBottom(xScale))
      .attr('color', colors.axes);

    svg.append('g')
      .call(d3.axisLeft(yScale).ticks(4))
      .attr('color', colors.axes);

    // bars
    binLabels.forEach((label, i) => {
      svg.append('rect')
        .attr('x', xScale(label)!)
        .attr('y', yScale(binCounts[i]))
        .attr('width', xScale.bandwidth())
        .attr('height', height - yScale(binCounts[i]))
        .attr('fill', i === 0 ? colors.nullBar : colors.bar);
    });
  }

  purge() {
    const toDelete = this.scores.filter(s => s.score < this.purgeThreshold);
    toDelete.forEach(({ id }) => this.searchService.del(id));
    const deleteIds = new Set(toDelete.map(s => s.id));
    this.bookmarks = this.bookmarks.filter((b: any) => !deleteIds.has(b.id));
    this.lastPurgeDate = Date.now();
    this.searchService.setMeta({ lastPurgeDate: this.lastPurgeDate });
    this.buildGrowthCurve();
    this.buildHistogram();
    this.buildVectorHistogram();
  }

  private saveSettings() {
    this.settingsService.get().then((settings) => {
      const all = Array.isArray(settings) ? settings : [settings];

      const indexedHalfLife = all.find(s => s.name === 'indexed-half-life');
      if (indexedHalfLife) indexedHalfLife.value = this.indexedHalfLifeDays;

      const unindexedHalfLife = all.find(s => s.name === 'unindexed-half-life');
      if (unindexedHalfLife) unindexedHalfLife.value = this.unindexedHalfLifeDays;

      const purge = all.find(s => s.name === 'purge-threshold');
      if (purge) purge.value = this.purgeThreshold;

      this.settingsService.set(all);
    });
  }
}
