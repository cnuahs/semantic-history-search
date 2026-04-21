// Sync settings — master key display, CouchDB URL management, and sync status

// 2026-04-04 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormGroup, FormBuilder, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';

import { SearchService } from '../search.service';
import { SettingsService, Setting } from '../settings.service';
import { SettingsListComponent } from '../settings-list/settings-list.component';

@Component({
  selector: 'app-sync-settings',
  imports: [FormsModule, ReactiveFormsModule, DatePipe, SettingsListComponent],
  templateUrl: './sync-settings.component.html',
})
export class SyncSettingsComponent implements OnInit, OnDestroy {
  masterKeyHex: string = '';
  copied: boolean = false;

  form: FormGroup;

  savedMessage: string = '';

  syncState: string = '';
  syncError: string = '';
  lastSynced: number | null = null;

  settings: Setting[] = [];

  private _statusPollInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    private searchService: SearchService,
    private settingsService: SettingsService,
    private formBuilder: FormBuilder,
  ) {
    this.form = this.formBuilder.group({
      couchdbUrl: ['', [Validators.pattern(/^(https?:\/\/.+)?$/)]],
      syncEnabled: [false],
    });
  }

  // returns true if sync is configured (i.e. has a valid CouchDB URL)
  get isConfigured(): boolean {
    const url = this.form.get('couchdbUrl')?.value ?? '';
    return this.form.get('couchdbUrl')?.valid === true && url.length > 0;
  }

  ngOnInit() {
    this.searchService.getSyncInfo().then(({ masterKeyHex, couchdbUrl, syncEnabled }) => {
      this.masterKeyHex = this.formatHex(masterKeyHex);
      this.form.patchValue({ couchdbUrl, syncEnabled });
    }).catch((err) => {
      console.error('SyncSettingsComponent.ngOnInit() configuration', err);
    });

    this.settingsService
      .get()
      .then((settings) => {
        if (!Array.isArray(settings)) return;

        this.settings = settings.filter(s => s.category === 'sync');
        this.settings.forEach(setting => {
          this.form.addControl(setting.name, this.formBuilder.control(setting.value));
        });
      })
      .catch((err) => {
        console.error('SyncSettingsComponent.ngOnInit() settings', err);
      });

    this.refreshStatus();

    // poll for status updates while the component is open
    this._statusPollInterval = setInterval(() => this.refreshStatus(), 5000);

    console.log('form valid:', this.form.valid, 'form errors:', JSON.stringify(this.form.errors), 'control errors:', JSON.stringify(Object.fromEntries(Object.entries(this.form.controls).map(([k,v]) => [k, v.errors]))))
  }

  ngOnDestroy() {
    if (this._statusPollInterval) {
      clearInterval(this._statusPollInterval);
      this._statusPollInterval = null;
    }
  }

  private refreshStatus() {
    this.searchService.getSyncStatus().then((status) => {
      if (!status) {
        this.syncState = 'Not configured';
        this.syncError = '';
        return;
      }

      switch (status.state) {
        case 'syncing': this.syncState = 'Syncing';       break;
        case 'ok':      this.syncState = 'Up to date';     break;
        case 'error':   this.syncState = 'Error';          break;
        case 'stopped': this.syncState = 'Not configured'; break;
      }

      this.syncError = status.error ?? '';
      this.lastSynced = status.lastSynced ?? null;
    }).catch((err) => {
      console.error('SyncSettingsComponent.refreshStatus()', err);
    });
  }

  async onCopyKey() {
    await navigator.clipboard.writeText(this.masterKeyHex.replace(/\s/g, ''));
    this.copied = true;
    setTimeout(() => this.copied = false, 2000);
  }

  onSubmit() {
    console.log('onSubmit this.settings:', this.settings)
    console.log('onSubmit form valid:', this.form.valid, 'form value:', this.form.value)
    if (!this.form.valid) return;
    console.log('onSubmit settings:', this.settings);

    const settings = this.settings.map(setting => ({
      ...setting,
      value: typeof setting.value === 'number'
        ? Number(this.form.value[setting.name])
        : this.form.value[setting.name],
    }));
    console.log('onSubmit settings (after spread and cast):', settings);

    Promise.all([
      this.settingsService.set(settings),
      this.searchService.setCouchdbUrl(this.form.value.couchdbUrl ?? ''),
      this.searchService.setSyncEnabled(this.form.value.syncEnabled ?? false),
    ])
      .then(() => {
        this.savedMessage = 'Saved ✓';
        setTimeout(() => this.savedMessage = '', 2000);
        this.refreshStatus();
      })
      .catch((err) => console.error('SyncSettingsComponent.onSubmit()', err));
  }

  onCancel() {
    this.searchService.getSyncInfo().then(({ couchdbUrl, syncEnabled }) => {
      this.form.patchValue({ couchdbUrl, syncEnabled });
    });

    this.settingsService.get()
      .then((settings) => {
        if (!Array.isArray(settings)) return;
        settings.filter(s => s.category === 'sync').forEach(setting => {
          this.form.patchValue({ [setting.name]: setting.value });
        });
      });
  }

  private formatHex(hex: string): string {
    return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
  }
}
