// Angular service wrapping the settings module

// 2024-11-26 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Injectable } from "@angular/core";

import _settings from "../settings";

import { Setting } from "../settings";
export type { Setting } from "../settings";

@Injectable({
  providedIn: "root",
})
export class SettingsService {
  constructor() {}

  get(name?: string): Promise<Setting[]> {
    return name
      ? (_settings.get(name) as Promise<Setting[]>)
      : (_settings.get() as Promise<Setting[]>);
  }

  set(settings: Setting[]): Promise<void> {
    return _settings.set(settings);
  }
}
