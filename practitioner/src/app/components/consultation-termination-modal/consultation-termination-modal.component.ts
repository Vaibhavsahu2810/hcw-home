import { Component, Inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { ButtonComponent } from '../ui/button/button.component';
import { ButtonSize, ButtonVariant } from '../../constants/button.enums';

export enum TerminationAction {
  Close = 'close',
  TerminateButKeepOpen = 'terminate_keep_open',
  StayInConsultation = 'stay'
}

@Component({
  selector: 'app-consultation-termination-modal',
  standalone: true,
  imports: [CommonModule, MatDialogModule, MatButtonModule, MatIconModule, ButtonComponent],
  templateUrl: './consultation-termination-modal.component.html',
  styleUrls: ['./consultation-termination-modal.component.scss']
})
export class ConsultationTerminationModalComponent {
  constructor(
    private dialogRef: MatDialogRef<ConsultationTerminationModalComponent>,
    @Inject(MAT_DIALOG_DATA) public data: any
  ) {}

  readonly ButtonSize = ButtonSize;
  readonly ButtonVariant = ButtonVariant;
  readonly TerminationAction = TerminationAction;

  onActionSelect(action: TerminationAction): void {
    this.dialogRef.close(action);
  }

  onClose(): void {
    this.dialogRef.close();
  }
}