import { Component, Input, ChangeDetectionStrategy} from '@angular/core';
import { SlicePipe, DatePipe } from '@angular/common';

import { SearchService } from '../search.service';

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [SlicePipe, DatePipe],
  templateUrl: './results.component.html',
  styleUrl: './results.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush
})
export class ResultsComponent {

  @Input() results: any[] = []; // TODO: change any[] to the Bookmark interface...?

  constructor(private searchService: SearchService) {
    // injects SearchService as this.searchService
  }

  delResult(id: string) {
    this.results = this.results.filter((result) => result.id !== id);

    this.searchService.del(id);
  }
}
