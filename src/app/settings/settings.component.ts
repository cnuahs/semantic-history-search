import { Component, OnInit } from "@angular/core";
import {
  FormsModule,
  ReactiveFormsModule,
  FormGroup,
  FormArray,
  FormBuilder,
} from "@angular/forms";
import { Router, RouterLink } from "@angular/router";

import { SettingsService, Setting } from "../settings.service";

// import { Pipe, PipeTransform } from '@angular/core';

// @Pipe({name: 'names', standalone: true, pure: true})
// export class NamesPipe implements PipeTransform {
//   transform(value: any) : any {
//     return Object.keys(value)
//   }
// }

@Component({
  selector: "app-settings",
  standalone: true,
  imports: [FormsModule, ReactiveFormsModule, RouterLink],
  templateUrl: "./settings.component.html",
  styleUrl: "./settings.component.css",
})
export class SettingsComponent implements OnInit {
  settings: Setting[] | null = null;

  form: FormGroup;

  constructor(
    private router: Router,
    private settingsService: SettingsService,
    private formBuilder: FormBuilder,
  ) {
    // injects SettingsService as this.settingsService and FormBuilder as this.formBuilder
    console.log("SettingsComponent.constructor()");

    this.form = this.formBuilder.group({}); // empty form group
  }

  ngOnInit() {
    console.log("SettingsComponent.ngOnInit()");
    this.settingsService
      .get()
      .then((settings: Setting[]) => {
        this.settings = settings;

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
        console.error("SettingsComponent.ngOnInit()", error);
      });
  }

  // form helpers

  // get FormArray from form by name
  getFormArray(name: string): FormArray {
    return this.form.get(name) as FormArray;
  }

  // add an item to a FormArray
  addItem(name: string) {
    this.getFormArray(name).push(this.formBuilder.control(""));
  }

  // remove an item from a FormArray
  delItem(name: string, index: number) {
    this.getFormArray(name).removeAt(index);
  }

  onSubmit() {
    console.log("SettingsComponent.onSubmit()");

    Object.entries(this.form.value).forEach(([key, value]) => {
      const setting = this.settings?.find((setting) => setting.name === key);
      if (setting) {
        setting.value = value as string | string[];
      }
    });

    this.settingsService.set(this.settings ? this.settings : []);

    this.router.navigate(["/"]);
  }

  onCancel() {
    this.router.navigate(["/"]);
  }

  unlock(passphrase: string) {
    // unlock settings
    // this.settingsService.unlock(passphrase);
    // const url = this.router.url
    // this.router.navigateByUrl('/', { skipLocationChange: true })
    // .then(() => {
    //   this.router.navigate([`${url}`]);
    // });
  }

  isArray(value: any) {
    return Array.isArray(value);
  }
}
