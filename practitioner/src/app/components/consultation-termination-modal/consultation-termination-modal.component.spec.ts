import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ConsultationTerminationModalComponent } from './consultation-termination-modal.component';

describe('ConsultationTerminationModalComponent', () => {
  let component: ConsultationTerminationModalComponent;
  let fixture: ComponentFixture<ConsultationTerminationModalComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConsultationTerminationModalComponent]
    })
    .compileComponents();

    fixture = TestBed.createComponent(ConsultationTerminationModalComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});