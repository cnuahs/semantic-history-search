// Settings tabs — vertical nav menu with child components rendered on the right

// 2026-04-04 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { GeneralSettingsComponent } from '../general-settings/general-settings.component';
import { SearchSettingsComponent } from '../search-settings/search-settings.component';
import { SyncSettingsComponent } from '../sync-settings/sync-settings.component';

import { ActionsComponent } from '../actions/actions.component';

type SettingsTab = 'general' | 'sync' | 'search' | 'actions';

@Component({
  selector: 'app-settings-tabs',
  imports: [RouterLink, GeneralSettingsComponent, SearchSettingsComponent, SyncSettingsComponent, ActionsComponent],
  templateUrl: './settings-tabs.component.html',
})
export class SettingsTabsComponent {
  activeTab: SettingsTab = 'general';

  setTab(tab: SettingsTab) {
    this.activeTab = tab;
  }
}
