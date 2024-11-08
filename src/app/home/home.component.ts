import { Component } from '@angular/core';
import { RouterOutlet, RouterLink } from '@angular/router';
import { ResultsComponent } from '../results/results.component';

@Component({
  selector: 'app-home',
  standalone: true,
  imports: [RouterOutlet, RouterLink, ResultsComponent],
  templateUrl: './home.component.html',
  styleUrl: './home.component.css'
})
export class HomeComponent {

}
