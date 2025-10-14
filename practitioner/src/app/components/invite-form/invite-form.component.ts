import {
  Component,
  Input,
  Output,
  EventEmitter,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
  Validators,
} from '@angular/forms';
import { ButtonComponent } from '../ui/button/button.component';
import {
  ButtonSize,
  ButtonVariant,
  ButtonType,
} from '../../constants/button.enums';
import { ViewEncapsulation } from '@angular/core';
import { InviteFormData } from '../../dtos/invites';
import { GroupService } from '../../services/group.service';
import { UserService } from '../../services/user.service';
import { Group } from '../../models/user.model';
import { forkJoin } from 'rxjs';

export interface CreatePatientConsultationFormData {
  firstName: string;
  lastName: string;
  gender: string;
  language: string;
  group?: string;
  contact: string;
  scheduledDate?: Date;
  specialityId?: number;
  symptoms?: string;
  planLater?: boolean;
  plannedDate?: string;
  timezone?: string;
  plannedTime?: string;
}

@Component({
  selector: 'app-invite-form',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, ButtonComponent],
  templateUrl: './invite-form.component.html',
  styleUrls: ['./invite-form.component.scss'],
  encapsulation: ViewEncapsulation.None,
})
export class InviteFormComponent implements OnInit, OnDestroy {
  @Input() type: 'remote' = 'remote';
  @Input() editData: InviteFormData | null = null;
  @Input() practitionerId!: number; // Required practitioner ID
  @Output() close = new EventEmitter<void>();
  @Output() submit = new EventEmitter<CreatePatientConsultationFormData>();

  readonly ButtonVariant = ButtonVariant;
  readonly ButtonSize = ButtonSize;
  readonly ButtonType = ButtonType;

  form!: FormGroup;
  genders = ['Male', 'Female', 'Other'];
  languages = ['English', 'French', 'German'];
  groups: Group[] = [];
  loading = false;
  timezones = [
    { code: 'Asia/Yerevan', name: 'Asia/Yerevan' },
    { code: 'Europe/London', name: 'Europe/London' },
    { code: 'Europe/Paris', name: 'Europe/Paris' },
    { code: 'America/New_York', name: 'America/New_York' },
    { code: 'America/Los_Angeles', name: 'America/Los_Angeles' },
  ];
  timeSlots = [
    '09:00', '09:30', '10:00', '10:30', '11:00', '11:30',
    '12:00', '12:30', '13:00', '13:30', '14:00', '14:30',
    '15:00', '15:30', '16:00', '16:30', '17:00', '17:30',
    '18:00', '18:30', '19:00', '19:30', '20:00', '20:30'
  ];
  guestOptions = [
    { key: 'lovedOne', label: 'Invite a loved one or another caregiver' },
    { key: 'colleague', label: 'Invite a colleague' },
  ];

  get isEditMode(): boolean {
    return this.editData !== null;
  }

  get modalTitle(): string {
    return this.isEditMode ? 'EDIT PATIENT' : 'CREATE PATIENT & CONSULTATION';
  }

  get submitButtonText(): string {
    return this.isEditMode ? 'Update' : 'Create';
  }

  get isPlanLaterSelected(): boolean {
    return this.form?.get('planLater')?.value === true;
  }

  constructor(
    private fb: FormBuilder,
    private groupService: GroupService,
    private userService: UserService
  ) {}

  ngOnInit(): void {
    document.body.classList.add('modal-open');
    this.form = this.buildForm();
    this.loadGroups();
    this.setupPlanLaterValidation();

    if (this.editData) {
      this.populateFormForEdit();
    }
  }

  private buildForm(): FormGroup {
    return this.fb.group({
      firstName: ['', Validators.required],
      lastName: ['', Validators.required],
      gender: ['', Validators.required],
      language: ['', Validators.required],
      group: [''],
      contact: [
        '',
        [
          Validators.required,
          Validators.pattern(/(^\+\d{2}\d{6,}$)|(^\S+@\S+\.\S+$)/),
        ],
      ],
      scheduledDate: [''],
      symptoms: [''],
      manualSend: [false],
      planLater: [false],
      plannedDate: [''],
      timezone: [''],
      plannedTime: [''],
      guests: this.fb.group({
        lovedOne: [false],
        colleague: [false],
      }),
    });
  }

  private populateFormForEdit(): void {
    if (!this.editData) return;

    this.form.patchValue({
      firstName: this.editData.firstName,
      lastName: this.editData.lastName,
      gender: this.editData.gender,
      language: this.editData.language,
      group: this.editData.group || '',
      contact: this.editData.contact,
    });
  }

  private loadGroups(): void {
    this.loading = true;
    
    this.userService.getCurrentUser().subscribe({
      next: (user) => {
        if (user.organizations && user.organizations.length > 0) {
          const organizationId = user.organizations[0].id;
          
          this.groupService.getGroupsByOrganization(organizationId).subscribe({
            next: (groups) => {
              this.groups = groups;
              this.loading = false;
            },
            error: (error) => {
              console.error('Error loading groups:', error);
              this.groups = [];
              this.loading = false;
            }
          });
        } else {
          console.warn('User has no organizations');
          this.groups = [];
          this.loading = false;
        }
      },
      error: (error) => {
        console.error('Error loading user data:', error);
        this.groups = [];
        this.loading = false;
      }
    });
  }

  private setupPlanLaterValidation(): void {
    this.form.get('planLater')?.valueChanges.subscribe((planLater: boolean) => {
      const plannedDateControl = this.form.get('plannedDate');
      const timezoneControl = this.form.get('timezone');
      const plannedTimeControl = this.form.get('plannedTime');

      if (planLater) {
        plannedDateControl?.setValidators([Validators.required]);
        timezoneControl?.setValidators([Validators.required]);
        plannedTimeControl?.setValidators([Validators.required]);
      } else {
        plannedDateControl?.clearValidators();
        timezoneControl?.clearValidators();
        plannedTimeControl?.clearValidators();
        plannedDateControl?.setValue('');
        timezoneControl?.setValue('');
        plannedTimeControl?.setValue('');
      }

      plannedDateControl?.updateValueAndValidity();
      timezoneControl?.updateValueAndValidity();
      plannedTimeControl?.updateValueAndValidity();
    });
  }

  ngOnDestroy(): void {
    document.body.classList.remove('modal-open');
  }

  onCancel(): void {
    document.body.classList.remove('modal-open');
    this.close.emit();
  }

  onSubmit(): void {
    document.body.classList.remove('modal-open');
    this.form.value.scheduledDate = this.form.value.scheduledDate ? new Date(this.form.value.scheduledDate) : new Date();
    
    const formData: CreatePatientConsultationFormData = {
      firstName: this.form.value.firstName,
      lastName: this.form.value.lastName,
      gender: this.form.value.gender,
      language: this.form.value.language,
      contact: this.form.value.contact,
      group: this.form.value.group || undefined,
      scheduledDate: this.form.value.scheduledDate || undefined,
      symptoms: this.form.value.symptoms || undefined,
      planLater: this.form.value.planLater || false,
      plannedDate: this.form.value.plannedDate || undefined,
      timezone: this.form.value.timezone || undefined,
      plannedTime: this.form.value.plannedTime || undefined,
    };

    this.submit.emit(formData);
  }
}