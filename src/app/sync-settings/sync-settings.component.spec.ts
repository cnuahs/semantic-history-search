import { ComponentFixture, TestBed } from '@angular/core/testing';

import { SyncSettingsComponent } from './sync-settings.component';

describe('SyncSettingsComponent', () => {
  let component: SyncSettingsComponent;
  let fixture: ComponentFixture<SyncSettingsComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SyncSettingsComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(SyncSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
