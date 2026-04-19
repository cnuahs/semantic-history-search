// Sync settings — master key display, CouchDB URL management, and sync status

// 2026-04-04 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Component, OnInit, OnDestroy } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormGroup, FormBuilder, Validators } from '@angular/forms';
import { DatePipe } from '@angular/common';

import { SearchService } from '../search.service';
import { SettingsService, Setting } from '../settings.service';
import { SettingsListComponent } from '../settings-list/settings-list.component';

@Component({
  selector: 'app-sync',
  imports: [FormsModule, ReactiveFormsModule, DatePipe, SettingsListComponent],
  templateUrl: './sync.component.html',
})
export class SyncComponent implements OnInit, OnDestroy {
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
    });
  }

  ngOnInit() {
    this.searchService.getSyncInfo().then(({ masterKeyHex, couchdbUrl }) => {
      this.masterKeyHex = this.formatHex(masterKeyHex);
      this.form.patchValue({ couchdbUrl });
    }).catch((err) => {
      console.error('SyncComponent.ngOnInit() master key', err);
    });

    this.settingsService
      .get()
      .then((settings: Setting[]) => {
        this.settings = settings.filter(s => s.category === 'sync');
        this.settings.forEach(setting => {
          this.form.addControl(setting.name, this.formBuilder.control(setting.value));
        });
      })
      .catch((err) => {
        console.error('SyncComponent.ngOnInit() settings', err);
      });

    this.refreshStatus();

    // poll for status updates while the component is open
    this._statusPollInterval = setInterval(() => this.refreshStatus(), 5000);
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
      console.error('SyncComponent.refreshStatus()', err);
    });
  }

  async onCopyKey() {
    await navigator.clipboard.writeText(this.masterKeyHex.replace(/\s/g, ''));
    this.copied = true;
    setTimeout(() => this.copied = false, 2000);
  }

  onSubmit() {
    if (!this.form.valid) return;

    const settings = this.settings.map(setting => ({
      ...setting,
      value: typeof setting.value === 'number'
        ? Number(this.form.value[setting.name])
        : this.form.value[setting.name],
    }));

    Promise.all([
      this.settingsService.set(settings),
      this.searchService.setCouchdbUrl(this.form.value.couchdbUrl ?? ''),
    ])
      .then(() => {
        this.savedMessage = 'Saved ✓';
        setTimeout(() => this.savedMessage = '', 2000);
        this.refreshStatus();
      })
      .catch((err) => console.error('SyncComponent.onSubmit()', err));
  }

  onCancel() {
    this.searchService.getSyncInfo().then(({ couchdbUrl }) => {
      this.form.patchValue({ couchdbUrl });
    });

    this.settingsService.get()
      .then((settings: Setting[]) => {
        settings.filter(s => s.category === 'sync').forEach(setting => {
          this.form.patchValue({ [setting.name]: setting.value });
        });
      });
  }

  private formatHex(hex: string): string {
    return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
  }
}
