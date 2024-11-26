import { Component, OnInit } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { SettingsService, Setting } from '../settings.service';

@Component({
  selector: 'app-settings',
  standalone: true,
  imports: [FormsModule, RouterLink],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.css'
})
export class SettingsComponent implements OnInit {
  settings: Setting[] | null = null; 

  constructor( private router: Router, private settingsService: SettingsService) {
      // injects SettingsService as this.settingsService
      console.log('SettingsComponent.constructor()');
  }

  ngOnInit() {
    console.log('SettingsComponent.ngOnInit()');
    this.settingsService.get()
    .then(
        (settings: Setting[]) => {this.settings = settings}
    )
    .catch(
        (error) => { this.settings = null; console.error('SettingsComponent.ngOnInit()', error); }
    );
  }

  onClick(apply: boolean) {
    if (apply ) {
      // apply the settings via the settings service
      this.settingsService.set(this.settings? this.settings : []);
    }

    this.router.navigate(['/']);
  }

  unlock(passphrase: string) {
    // unlock settings
    // this.settingsService.unlock(passphrase);

    // const url = this.router.url
    // this.router.navigateByUrl('/', { skipLocationChange: true })
    // .then(() => {
    //   this.router.navigate([`${url}`]);
    // });
  }
}
