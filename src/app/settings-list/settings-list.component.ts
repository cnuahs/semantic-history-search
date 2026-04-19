// Shared presentation component for rendering a list of settings fields.

// 2026-04-19 - Shaun L. Cloherty <s.cloherty@ieee.org>

import { Component, Input } from '@angular/core';
import {
  FormsModule,
  ReactiveFormsModule,
  FormGroup,
  FormArray,
  FormBuilder,
} from '@angular/forms';

import { Setting } from '../settings.service';

@Component({
  selector: 'app-settings-list',
  imports: [FormsModule, ReactiveFormsModule],
  templateUrl: './settings-list.component.html',
  // styleUrl: './settings-list.component.css',
})
export class SettingsListComponent {
  @Input() settings: Setting[] = [];
  @Input() form!: FormGroup;

  constructor(private formBuilder: FormBuilder) {}

  // form helpers

  // get FormArray from form by name
  getFormArray(name: string): FormArray {
    return this.form.get(name) as FormArray;
  }

  // add an item to a FormArray
  addItem(name: string) {
    this.getFormArray(name).push(this.formBuilder.control(''));
  }

  // remove an item from a FormArray
  delItem(name: string, index: number) {
    this.getFormArray(name).removeAt(index);
  }

  isArray(value: any) {
    return Array.isArray(value);
  }

  isNumber(value: any) {
    return typeof value === 'number';
  }
}