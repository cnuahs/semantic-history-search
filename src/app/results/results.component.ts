import { Component, Input, Output, EventEmitter, ChangeDetectionStrategy, ChangeDetectorRef } from "@angular/core";
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
  @Input() showUnindexed: boolean = false;
  @Output() showUnindexedChange = new EventEmitter<boolean>();

  pending = new Set<string>(); // set of bookmark ids currently pending (e.g., being refreshed)

  get nrUnique(): number { // number of unique pages in this.results
    return new Set(this.results.map((r) => r.id)).size;
  }

  constructor(
    private searchService: SearchService,
    private cdr: ChangeDetectorRef) {
    // injects SearchService as this.searchService
    // injects ChangeDetectorRef as this.cdr (used to trigger change detection before/after refreshing)
  }

  async refreshResult(id: string, href: string) {
    this.pending.add(id);

    this.cdr.markForCheck();

    try {
      await this.searchService.refresh(id, href);

      // update nrVectors optimistically — actual count will reconcile later
      const item = this.results.find(r => r.id === id);
      if (item) item.nrVectors = null; // null triggers reconciliation in maintenance task
    } catch (err) {
      console.error("Refresh failed:", err);
    }

    this.pending.delete(id);

    this.cdr.markForCheck();
  }

  delResult(id: string) {
    this.results = this.results.filter((result) => result.id !== id);

    this.searchService.del(id);
  }
}
