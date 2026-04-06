import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SettingsTabsComponent } from './settings-tabs.component';

describe('SettingsTabsComponent', () => {
  let component: SettingsTabsComponent;
  let fixture: ComponentFixture<SettingsTabsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SettingsTabsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SettingsTabsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
