// Angular service wrapping Electron IPC for user settings.

// 2024-06-09 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Injectable } from '@angular/core';

import _settings from '../settings';

import { Setting } from '../settings';
export type { Setting } from '../settings';

@Injectable({
  providedIn: 'root'
})
export class SettingsService {
  // key: string | null = null;

  constructor() { }

  // lock (): void {
  //   // console.log('SettingsService.lock()');
  //   // 1. clear this.settings
  //   // 2. discard key
  //   this.key = null;
  //   // 3. clear retriever in the service worker?
  // }

  // unlock (passphrase?: string): Promise<void> {
  //   // console.log('SettingsService.unlock():', passphrase);
  //   return new Promise((resolve, _reject) => {
  //     // 1. generate key from passphrase
  //     this.key = passphrase? passphrase : null;
  //     // 2. retrieve settings from chrome.storage.sync
  //     // 3. decrypt settings using key
  //     resolve();
  //   });
  // }

  get (name?: string): Promise<Setting[]> {
    // console.log('SettingsService.get()', name);
    // return new Promise((resolve, reject) => {
    //   this.settings && this.key ?
    //     // resolve(name ? this.settings.filter((setting) => setting.name === name) : this.settings) :
    //     resolve(name ? [ _get(name) as Setting ] : _get() as Setting[]) :
    //     reject(Error('Failed to load settings!')) // locked?
    // });
    return name ? _settings.get(name) as Promise<Setting[]> : _settings.get() as Promise<Setting[]>;
  }

  set (settings: Setting[]): void {
    // console.log('SettingsService.set()', setting);
    _settings.set(settings);
  }
}
