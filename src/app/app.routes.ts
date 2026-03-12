import { Routes } from "@angular/router";

import { HomeComponent } from "./home/home.component";
import { SettingsComponent } from "./settings/settings.component";
import { DashboardComponent } from "./dashboard/dashboard.component";

export const routes: Routes = [
  { path: "", title: "Home", component: HomeComponent },
  { path: "settings", title: "Settings", component: SettingsComponent },
  { path: "dashboard", title: "Dashboard", component: DashboardComponent },
  { path: "", redirectTo: "/home", pathMatch: "full" },
];
