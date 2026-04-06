// Settings tabs — vertical nav menu with child components rendered on the right

// 2026-04-04 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

import { SettingsComponent } from '../settings/settings.component';
import { SyncComponent } from '../sync/sync.component';
import { ActionsComponent } from '../actions/actions.component';

type SettingsTab = 'general' | 'sync' | 'actions';

@Component({
  selector: 'app-settings-tabs',
  imports: [RouterLink, SettingsComponent, SyncComponent, ActionsComponent],
  templateUrl: './settings-tabs.component.html',
})
export class SettingsTabsComponent {
  activeTab: SettingsTab = 'general';

  setTab(tab: SettingsTab) {
    this.activeTab = tab;
  }
}
