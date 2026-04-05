import { CanMatchFn, Routes, Router } from '@angular/router';
import { inject } from '@angular/core';

import { SearchService } from './search.service';

import { HomeComponent } from "./home/home.component";
import { SettingsComponent } from "./settings/settings.component";
import { DashboardComponent } from "./dashboard/dashboard.component";

import { SetupComponent } from "./setup/setup.component";

const setupComplete: CanMatchFn = () => {
  const searchService = inject(SearchService);
  const router = inject(Router);  // inject here, in the synchronous injection context
  return searchService.status().then(({ setupRequired }) => {
    if (setupRequired) {
      return router.createUrlTree(['/setup']);  // use captured reference
    }
    return true;
  });
};

export const routes: Routes = [
  { path: "", title: "Home", canMatch: [setupComplete], component: HomeComponent, pathMatch: "full" },
  { path: "settings", title: "Settings", component: SettingsComponent },
  { path: "dashboard", title: "Dashboard", component: DashboardComponent },
  { path: "setup", title: "Setup", component: SetupComponent },
  { path: "**", redirectTo: "", pathMatch: "full" },
];