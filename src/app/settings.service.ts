// Angular service wrapping the settings module

// 2024-11-26 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Injectable } from "@angular/core";

import type { Setting, SettingValue } from "../settings";
export type { Setting, SettingValue };

@Injectable({
  providedIn: "root",
})
export class SettingsService {
  constructor() {}

  get(name?: string): Promise<Setting | Setting[]> {
  return chrome.runtime.sendMessage({ type: 'get-settings', payload: name })
    .then((response) => {
      if (!response || response.type !== 'result') {
        throw new Error('Failed to get settings.');
      }
      return response.payload as Setting | Setting[];
    });
}

  set(settings: Setting[]): Promise<void> {
    return chrome.runtime.sendMessage({ type: 'set-settings', payload: settings })
      .then((response) => {
        if (!response || response.type !== 'result') {
          throw new Error('Failed to save settings.');
        }
      });
  }
}