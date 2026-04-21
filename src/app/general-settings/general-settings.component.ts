import { Component, OnInit } from "@angular/core";
import {
  FormsModule,
  ReactiveFormsModule,
  FormGroup,
  FormArray,
  FormBuilder,
} from "@angular/forms";

import { SettingsService, Setting } from "../settings.service";

import { SettingsListComponent } from "../settings-list/settings-list.component";

@Component({
  selector: "app-general-settings",
  imports: [FormsModule, ReactiveFormsModule, SettingsListComponent],
  templateUrl: "./general-settings.component.html",
  styleUrl: "./general-settings.component.css",
})
export class GeneralSettingsComponent implements OnInit {
  settings: Setting[] | null = null;

  form: FormGroup;

  savedMessage: string = '';

  constructor(
    private settingsService: SettingsService,
    private formBuilder: FormBuilder,
  ) {
    // injects SettingsService as this.settingsService and FormBuilder as this.formBuilder
    console.log("GeneralSettingsComponent.constructor()");

    this.form = this.formBuilder.group({}); // empty form group
  }

  ngOnInit() {
    console.log("GeneralSettingsComponent.ngOnInit()");
    this.settingsService
      .get()
      .then((settings) => {
        if (!Array.isArray(settings)) return;

        this.settings = settings.filter(s => s.category === 'general');

        // create form controls
        this.settings?.forEach((setting) => {
          if (Array.isArray(setting.value)) {
            this.form.addControl(
              setting.name,
              this.formBuilder.array(
                setting.value.map((value) => this.formBuilder.control(value)),
              ),
            );
          } else {
            this.form.addControl(
              setting.name,
              this.formBuilder.control(setting.value),
            );
          }
        });
      })
      .catch((error) => {
        this.settings = null;
        console.error("GeneralSettingsComponent.ngOnInit()", error);
      });
  }

  onSubmit() {
    console.log("GeneralSettingsComponent.onSubmit()");

    Object.entries(this.form.value).forEach(([key, value]) => {
      const setting = this.settings?.find((setting) => setting.name === key);
      if (setting) {
        setting.value = typeof setting.value === 'number'
          ? Number(value)
          : value as string | string[];
      }
    });

    this.settingsService.set(this.settings ? this.settings : [])
      .then(() => {
        this.savedMessage = 'Saved ✓';
        setTimeout(() => this.savedMessage = '', 2000);
      })
      .catch((err) => console.error('GeneralSettingsComponent.onSubmit()', err));
  }

  onCancel() {
    // revert form to last saved state by re-fetching settings
    this.form = this.formBuilder.group({});
    this.ngOnInit();
  }
}
