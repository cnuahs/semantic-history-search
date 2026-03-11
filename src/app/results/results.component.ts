import { Component, Input, ChangeDetectionStrategy } from "@angular/core";
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

  @Input() nrTotal: number = 0; // total pages in the database

  @Input() isLoading: boolean = false;

  get nrUnique(): number { // number of unique pages in this.results
    return new Set(this.results.map((r) => r.id)).size;
  }

  constructor(private searchService: SearchService) {
    // injects SearchService as this.searchService
  }

  delResult(id: string) {
    this.results = this.results.filter((result) => result.id !== id);

    this.searchService.del(id);
  }
}
