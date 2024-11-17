import { Component, Input, ChangeDetectionStrategy} from '@angular/core';
import { SlicePipe, DatePipe } from '@angular/common';

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

}
