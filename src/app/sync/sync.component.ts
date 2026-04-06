// Sync settings — master key display and CouchDB URL management

// 2026-04-04 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Component, OnInit } from '@angular/core';
import { FormsModule, ReactiveFormsModule, FormGroup, FormBuilder, Validators } from '@angular/forms';
import { SearchService } from '../search.service';

@Component({
  selector: 'app-sync',
  imports: [FormsModule, ReactiveFormsModule],
  templateUrl: './sync.component.html',
})
export class SyncComponent implements OnInit {
  masterKeyHex: string = '';
  copied: boolean = false;

  form: FormGroup;

  savedMessage: string = '';

  constructor(
    private searchService: SearchService,
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
      console.error('SyncComponent.ngOnInit()', err);
    });
  }

  async onCopyKey() {
    await navigator.clipboard.writeText(this.masterKeyHex.replace(/\s/g, ''));
    this.copied = true;
    setTimeout(() => this.copied = false, 2000);
  }

  onSubmit() {
    if (!this.form.valid) return;
    this.searchService.setCouchdbUrl(this.form.value.couchdbUrl ?? '')
      .then(() => {
        this.savedMessage = 'Saved ✓';
        setTimeout(() => this.savedMessage = '', 2000);
      })
      .catch((err) => console.error('SyncComponent.onSubmit()', err));
  }

  onCancel() {
    this.searchService.getSyncInfo().then(({ couchdbUrl }) => {
      this.form.patchValue({ couchdbUrl });
    });
  }

  private formatHex(hex: string): string {
    return hex.match(/.{1,4}/g)?.join(' ') ?? hex;
  }
}
