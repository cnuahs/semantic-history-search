import { Routes } from '@angular/router';

import { HomeComponent } from './home/home.component';
import { SettingsComponent } from './settings/settings.component';

export const routes: Routes = [
    { path: '', title: 'Home', component: HomeComponent},
    { path: 'settings', title: 'Settings', component: SettingsComponent },
    { path: '', redirectTo: '/home', pathMatch: 'full' }
];
