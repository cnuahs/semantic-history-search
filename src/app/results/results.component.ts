import { Component, Input, ChangeDetectionStrategy, ChangeDetectorRef } from "@angular/core";
import { SlicePipe, DatePipe } from "@angular/common";

import { SearchService } from "../search.service";

@Component({
  selector: "app-results",
  imports: [SlicePipe, DatePipe],
  templateUrl: "./results.component.html",
  styleUrl: "./results.component.css",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ResultsComponent {
  @Input() results: any[] = []; // TODO: change any[] to the Bookmark interface...?
  @Input() mode: 'history' | 'search' = 'history';

  @Input() isLoading: boolean = false;

  reindexing = new Set<string>(); // set of bookmark ids currently being reindexed

  get nrUnique(): number { // number of unique pages in this.results
    return new Set(this.results.map((r) => r.id)).size;
  }

  constructor(
    private searchService: SearchService,
    private cdr: ChangeDetectorRef) {
    // injects SearchService as this.searchService
    // injects ChangeDetectorRef as this.cdr (used to trigger change detection before/after reindexing)
  }

  async reindexResult(id: string, href: string) {
    this.reindexing.add(id);

    this.cdr.markForCheck();

    try {
      await this.searchService.reindex(id, href);

      // update nrVectors optimistically — actual count will reconcile later
      const item = this.results.find(r => r.id === id);
      if (item) item.nrVectors = null; // null triggers reconciliation in maintenance task

      // this.reindexing.delete(id);
    } catch (err) {
      console.error("Reindex failed:", err);
      // this.reindexing.delete(id);
    }

    this.reindexing.delete(id);

    this.cdr.markForCheck();
  }

  delResult(id: string) {
    this.results = this.results.filter((result) => result.id !== id);

    this.searchService.del(id);
  }
}
