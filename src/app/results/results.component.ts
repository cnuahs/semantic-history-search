import { Component } from '@angular/core';
import { SlicePipe, DatePipe } from '@angular/common';

import { SearchService } from '../search.service';

@Component({
  selector: 'app-results',
  standalone: true,
  imports: [SlicePipe, DatePipe],
  templateUrl: './results.component.html',
  styleUrl: './results.component.css'
})
export class ResultsComponent {
  count: number = 4;

  results: any[];

  constructor(private searchService: SearchService) {
    this.results = this.searchService.query('*');
   }
}
