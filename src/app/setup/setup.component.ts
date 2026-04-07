// Setup wizard — shown on first install when no masterKey exists

// 2026-04-04 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Component } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';

import { SearchService } from '../search.service';

type SetupStep =
  | 'choose'      // initial choice: new install vs join existing sync
  | 'new-key'     // new install: display generated masterKey
  | 'join-key'    // join existing: paste masterKey + enter CouchDB URL
  | 'sync-url';   // new install: optionally enter CouchDB URL

@Component({
  selector: 'app-setup',
  imports: [FormsModule],
  templateUrl: './setup.component.html',
})
export class SetupComponent {
  version: string = '';

  step: SetupStep = 'choose';

  masterKeyHex: string = '';     // formatted hex masterKey for display
  masterKeyInput: string = '';   // user-pasted hex masterKey (join path)
  couchdbUrl: string = '';       // user-entered CouchDB URL
  errorMessage: string = '';
  isWorking: boolean = false;
  copied: boolean = false;       // clipboard feedback

  constructor(
    private router: Router,
    private searchService: SearchService) {
  }

  ngOnInit() {
    this.version = chrome.runtime.getManifest().version;
  }

  // --- New installation path ---

  async onNewInstall() {
    this.isWorking = true;
    this.errorMessage = '';
    try {
      const hex = await this.searchService.setupNew();
      this.masterKeyHex = this.formatHex(hex);
      this.step = 'new-key';
    } catch (err) {
      this.errorMessage = 'Failed to generate master key. Please try again.';
      console.error('SetupComponent.onNewInstall()', err);
    } finally {
      this.isWorking = false;
    }
  }

  async onCopyKey() {
    await navigator.clipboard.writeText(this.masterKeyHex.replace(/\s/g, ''));
    this.copied = true;
    setTimeout(() => this.copied = false, 2000);
  }

  onNewKeySaved() {
    this.step = 'sync-url';
  }

  // --- Join existing sync path ---

  onJoinExisting() {
    this.step = 'join-key';
  }

  async onJoinComplete() {
    this.isWorking = true;
    this.errorMessage = '';
    try {
      const hex = this.masterKeyInput.replace(/\s/g, '');
      await this.searchService.setupJoin(hex, this.couchdbUrl);
      await this.searchService.setupComplete();
      this.router.navigate(['/']);
    } catch (err) {
      this.errorMessage = err instanceof Error ? err.message : 'Failed to join sync. Please check your master key and CouchDB URL.';
      console.error('SetupComponent.onJoinComplete()', err);
    } finally {
      this.isWorking = false;
    }
  }

  // --- CouchDB URL step (new install path only) ---

  async onSkipCouchdb() {
    this.couchdbUrl = ''; // ensure empty string if user wants to skip
    await this.onCouchdbComplete();
  }

  async onCouchdbComplete() {
    this.isWorking = true;
    this.errorMessage = '';
    try {
      await this.searchService.setupJoin(
        this.masterKeyHex.replace(/\s/g, ''),
        this.couchdbUrl
      );
      await this.searchService.setupComplete();
      this.router.navigate(['/']);
    } catch (err) {
      this.errorMessage = 'Failed to complete setup. Please try again.';
      console.error('SetupComponent.onCouchdbComplete()', err);
    } finally {
      this.isWorking = false;
    }
  }

  // --- Helpers ---

  // format 64-char hex string as 16 groups of 4 characters for readability
  private formatHex(hex: string): string {
    return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
  }

  get masterKeyInputValid(): boolean {
    // strip whitespace and check for 64 hex characters
    const stripped = this.masterKeyInput.replace(/\s/g, '');
    return /^[0-9a-fA-F]{64}$/.test(stripped);
  }
}
