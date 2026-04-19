// Search settings tab — renders settings with category 'search'.

// 2026-04-19 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Component, OnInit } from '@angular/core';
import {
  FormsModule,
  ReactiveFormsModule,
  FormGroup,
  FormArray,
  FormBuilder,
} from '@angular/forms';

import { SettingsService, Setting } from '../settings.service';
import { SettingsListComponent } from '../settings-list/settings-list.component';

@Component({
  selector: 'app-search-settings',
  imports: [FormsModule, ReactiveFormsModule, SettingsListComponent],
  templateUrl: './search-settings.component.html',
  // styleUrl: './search-settings.component.css',
})
export class SearchSettingsComponent implements OnInit {
  settings: Setting[] | null = null;

  form: FormGroup;

  savedMessage: string = '';

  constructor(
    private settingsService: SettingsService,
    private formBuilder: FormBuilder,
  ) {
    this.form = this.formBuilder.group({});
  }

  ngOnInit() {
    this.settingsService.get().then((settings: Setting[]) => {
      this.settings = settings.filter(s => s.category === 'search');

      this.settings.forEach(setting => {
        if (Array.isArray(setting.value)) {
          this.form.addControl(
            setting.name,
            this.formBuilder.array(
              setting.value.map(value => this.formBuilder.control(value)),
            ),
          );
        } else {
          this.form.addControl(
            setting.name,
            this.formBuilder.control(setting.value),
          );
        }
      });
    }).catch((err) => {
      this.settings = null;
      console.error('SearchSettingsComponent.ngOnInit()', err);
    });
  }

  onSubmit() {
    Object.entries(this.form.value).forEach(([key, value]) => {
      const setting = this.settings?.find(s => s.name === key);
      if (setting) {
        setting.value = typeof setting.value === 'number'
          ? Number(value)
          : value as string | string[];
      }
    });

    this.settingsService.set(this.settings ? this.settings : [])
      .then(() => {
        this.savedMessage = 'Saved ✓';
        setTimeout(() => this.savedMessage = '', 2000);
      })
      .catch((err) => console.error('SearchSettingsComponent.onSubmit()', err));
  }

  onCancel() {
    this.ngOnInit();
  }
}
