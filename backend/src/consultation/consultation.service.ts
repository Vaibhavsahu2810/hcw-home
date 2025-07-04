import { Injectable, Inject, forwardRef } from '@nestjs/common';
import { DatabaseService } from 'src/database/database.service';
import { ConsultationStatus, UserRole } from '@prisma/client';
import { Server } from 'socket.io';
import { HttpExceptionHelper } from 'src/common/helpers/execption/http-exception.helper';
import { ApiResponseDto } from 'src/common/helpers/response/api-response.dto';
import { JoinConsultationResponseDto } from './dto/join-consultation.dto';
import { WaitingRoomPreviewResponseDto } from './dto/waiting-room-preview.dto';
import {
  AdmitPatientDto,
  AdmitPatientResponseDto,
} from './dto/admit-patient.dto';
import {
  CreateConsultationDto,
  ConsultationResponseDto,
} from './dto/create-consultation.dto';
import { ConsultationHistoryItemDto } from './dto/consultation-history-item.dto';
import { ConsultationDetailDto } from './dto/consultation-detail.dto';
import { plainToInstance } from 'class-transformer';
import {
  OpenConsultationResponseDto,
  OpenConsultationItemDto,
  OpenConsultationPatientDto,
  JoinOpenConsultationResponseDto,
  CloseConsultationResponseDto,
} from './dto/open-consultation.dto';

@Injectable()
export class ConsultationService {
  constructor(
    private readonly db: DatabaseService,
    @Inject(forwardRef(() => 'CONSULTATION_GATEWAY'))
    private readonly wsServer: Server,
  ) {}

  /**
   * Create a new consultation (practitioner/admin only).
   * A patient can have only one active consultation at a time.
   */
  async createConsultation(
    createDto: CreateConsultationDto,
    userId: number,
  ): Promise<ApiResponseDto<ConsultationResponseDto>> {
    const creator = await this.db.user.findUnique({ where: { id: userId } });
    if (!creator) throw HttpExceptionHelper.notFound('Creator user not found');
    if (
      creator.role !== UserRole.PRACTITIONER &&
      creator.role !== UserRole.ADMIN
    ) {
      throw HttpExceptionHelper.forbidden(
        'Only practitioners or admins can create consultations',
      );
    }

    const patient = await this.db.user.findUnique({
      where: { id: createDto.patientId },
    });
    if (!patient) throw HttpExceptionHelper.notFound('Patient does not exist');
    if (patient.role !== UserRole.PATIENT)
      throw HttpExceptionHelper.badRequest('Target user is not a patient');

    let ownerId = createDto.ownerId ?? userId;
    const practitioner = await this.db.user.findUnique({
      where: { id: ownerId },
    });
    if (!practitioner || practitioner.role !== UserRole.PRACTITIONER)
      throw HttpExceptionHelper.badRequest(
        'Owner must be a valid practitioner',
      );

    const existing = await this.db.consultation.findFirst({
      where: {
        participants: {
          some: { userId: createDto.patientId },
        },
        status: {
          in: [
            ConsultationStatus.SCHEDULED,
            ConsultationStatus.WAITING,
            ConsultationStatus.ACTIVE,
          ],
        },
      },
    });
    if (existing)
      throw HttpExceptionHelper.conflict(
        'Patient already has an active consultation',
      );

    const consultation = await this.db.consultation.create({
      data: {
        ownerId,
        scheduledDate: createDto.scheduledDate,
        createdBy: userId,
        status: ConsultationStatus.SCHEDULED,
        groupId: createDto.groupId,
        participants: {
          create: {
            userId: createDto.patientId,
            isActive: false,
            isBeneficiary: true,
          },
        },
      },
      include: { participants: true },
    });

    return ApiResponseDto.success(
      plainToInstance(ConsultationResponseDto, consultation),
      'Consultation created',
      201,
    );
  }

  /**
   * Patient joins a consultation (enters waiting room).
   */
  async joinAsPatient(
    consultationId: number,
    patientId: number,
  ): Promise<ApiResponseDto<JoinConsultationResponseDto>> {
    const consultation = await this.db.consultation.findUnique({
      where: { id: consultationId },
    });
    if (!consultation)
      throw HttpExceptionHelper.notFound('Consultation not found');

    if (consultation.status === ConsultationStatus.COMPLETED) {
      throw HttpExceptionHelper.badRequest(
        'Cannot join completed consultation',
      );
    }

    const patient = await this.db.user.findUnique({ where: { id: patientId } });
    if (!patient) throw HttpExceptionHelper.notFound('Patient does not exist');
    if (patient.role !== UserRole.PATIENT)
      throw HttpExceptionHelper.badRequest('User is not a patient');

    const isAssigned = await this.db.participant.findUnique({
      where: { consultationId_userId: { consultationId, userId: patientId } },
    });
    if (!isAssigned)
      throw HttpExceptionHelper.forbidden(
        'Patient is not assigned to this consultation',
      );

    const activeConsultation = await this.db.consultation.findFirst({
      where: {
        id: { not: consultationId },
        participants: {
          some: { userId: patientId, isActive: true },
        },
        status: {
          in: [
            ConsultationStatus.SCHEDULED,
            ConsultationStatus.WAITING,
            ConsultationStatus.ACTIVE,
          ],
        },
      },
    });
    if (activeConsultation)
      throw HttpExceptionHelper.conflict(
        'Patient is already active in another consultation',
      );

    await this.db.participant.update({
      where: { consultationId_userId: { consultationId, userId: patientId } },
      data: { isActive: true, joinedAt: new Date() },
    });

    if (consultation.status === ConsultationStatus.SCHEDULED) {
      await this.db.consultation.update({
        where: { id: consultationId },
        data: { status: ConsultationStatus.WAITING },
      });
    }

    if (consultation.ownerId && this.wsServer) {
      this.wsServer
        .to(`practitioner:${consultation.ownerId}`)
        .emit('patient_waiting', {
          consultationId,
          patientInitials: `${patient.firstName?.[0] ?? ''}${patient.lastName?.[0] ?? ''}`,
          joinTime: new Date(),
          language: patient.country ?? null,
        });
    }

    const responsePayload: JoinConsultationResponseDto = {
      success: true,
      statusCode: 200,
      message: 'Patient joined consultation and entered waiting room.',
      consultationId,
    };

    return ApiResponseDto.success(
      responsePayload,
      responsePayload.message,
      responsePayload.statusCode,
    );
  }

  /**
   * Practitioner joins a consultation (admits themselves).
   */
  async joinAsPractitioner(
    consultationId: number,
    practitionerId: number,
  ): Promise<ApiResponseDto<JoinConsultationResponseDto>> {
    const consultation = await this.db.consultation.findUnique({
      where: { id: consultationId },
    });
    if (!consultation)
      throw HttpExceptionHelper.notFound('Consultation not found');

    const practitioner = await this.db.user.findUnique({
      where: { id: practitionerId },
    });
    if (!practitioner)
      throw HttpExceptionHelper.notFound('Practitioner does not exist');

    if (consultation.ownerId !== practitionerId) {
      throw HttpExceptionHelper.forbidden(
        'Not the practitioner for this consultation',
      );
    }

    if (consultation.status === ConsultationStatus.COMPLETED) {
      throw HttpExceptionHelper.badRequest(
        'Cannot join completed consultation',
      );
    }

    await this.db.participant.upsert({
      where: {
        consultationId_userId: { consultationId, userId: practitionerId },
      },
      create: {
        consultationId,
        userId: practitionerId,
        isActive: true,
        joinedAt: new Date(),
      },
      update: { isActive: true, joinedAt: new Date() },
    });

    await this.db.consultation.update({
      where: { id: consultationId },
      data: { status: ConsultationStatus.ACTIVE },
    });

    if (this.wsServer) {
      this.wsServer
        .to(`consultation:${consultationId}`)
        .emit('consultation_status', {
          status: 'ACTIVE',
          initiatedBy: 'PRACTITIONER',
        });
    }

    const responsePayload: JoinConsultationResponseDto = {
      success: true,
      statusCode: 200,
      message: 'Practitioner joined and activated the consultation.',
      consultationId,
    };

    return ApiResponseDto.success(
      responsePayload,
      responsePayload.message,
      responsePayload.statusCode,
    );
  }

  /**
   * Practitioner or admin explicitly admits a patient (manual admit flow).
   * Only users with PRACTITIONER or ADMIN role are allowed.
   */
  async admitPatient(
    dto: AdmitPatientDto,
    userId: number,
  ): Promise<ApiResponseDto<AdmitPatientResponseDto>> {
    const consultation = await this.db.consultation.findUnique({
      where: { id: dto.consultationId },
    });
    if (!consultation)
      throw HttpExceptionHelper.notFound('Consultation not found');

    const user = await this.db.user.findUnique({ where: { id: userId } });
    if (!user) throw HttpExceptionHelper.notFound('User not found');

    if (user.role !== UserRole.PRACTITIONER && user.role !== UserRole.ADMIN) {
      throw HttpExceptionHelper.forbidden(
        'Only practitioners or admins can admit patients',
      );
    }

    if (consultation.ownerId !== userId && user.role !== UserRole.ADMIN) {
      throw HttpExceptionHelper.forbidden(
        'Not authorized to admit patient to this consultation',
      );
    }

    if (consultation.status !== ConsultationStatus.WAITING) {
      throw HttpExceptionHelper.badRequest(
        'Consultation is not in waiting state',
      );
    }

    try {
      const updatedConsultation = await this.db.consultation.update({
        where: {
          id: dto.consultationId,
          version: consultation.version, // Optimistic concurrency
        },
        data: {
          status: ConsultationStatus.ACTIVE,
          version: consultation.version + 1,
        },
      });

      if (this.wsServer) {
        try {
          this.wsServer
            .to(`consultation:${dto.consultationId}`)
            .emit('consultation_status', {
              status: 'ACTIVE',
              initiatedBy: user.role,
            });
        } catch (socketError) {
          // Log but do not throw
          console.error('WebSocket emission failed:', socketError);
        }
      }

      return ApiResponseDto.success(
        {
          success: true,
          statusCode: 200,
          message: 'Patient admitted and consultation activated.',
          consultationId: dto.consultationId,
        },
        'Patient admitted successfully',
        200,
      );
    } catch (error) {
      if (error.code === 'P2025') {
        throw HttpExceptionHelper.conflict(
          'Consultation state changed. Please refresh and retry.',
          error,
        );
      }
      console.error('Admission failed:', error);
      throw HttpExceptionHelper.internalServerError(
        'Failed to admit patient',
        error,
      );
    }
  }

  /**
   * Fetches all consultations in WAITING for a practitioner,
   * where patient has joined (isActive=true) but practitioner has not.
   */
  async getWaitingRoomConsultations(
    practitionerId: number,
  ): Promise<ApiResponseDto<WaitingRoomPreviewResponseDto>> {
    const practitioner = await this.db.user.findUnique({
      where: { id: practitionerId },
    });
    if (!practitioner) {
      throw HttpExceptionHelper.notFound('User not found');
    }

    const consultations = await this.db.consultation.findMany({
      where: {
        status: ConsultationStatus.WAITING,
        ownerId: practitionerId,
        participants: {
          some: {
            isActive: true,
            user: { role: UserRole.PATIENT },
          },
        },
        NOT: {
          participants: {
            some: {
              isActive: true,
              user: { role: UserRole.PRACTITIONER },
            },
          },
        },
      },
      select: {
        id: true,
        participants: {
          where: {
            isActive: true,
            user: { role: UserRole.PATIENT },
          },
          select: {
            joinedAt: true,
            user: {
              select: {
                firstName: true,
                lastName: true,
                country: true,
              },
            },
          },
        },
      },
      orderBy: { scheduledDate: 'asc' },
    });

    const waitingRooms = consultations.map((c) => {
      const patient = c.participants[0]?.user;
      return {
        id: c.id,
        patientInitials: patient
          ? `${patient.firstName?.[0] ?? ''}${patient.lastName?.[0] ?? ''}`
          : '',
        joinTime: c.participants[0]?.joinedAt ?? null,
        language: patient?.country ?? null,
      };
    });

    const responsePayload = new WaitingRoomPreviewResponseDto({
      success: true,
      statusCode: 200,
      message: 'Waiting room consultations fetched.',
      waitingRooms,
      totalCount: waitingRooms.length,
    });

    return ApiResponseDto.success(
      responsePayload,
      responsePayload.message,
      responsePayload.statusCode,
    );
  }

  /**
   * Fetch closed consultations for a practitioner.
   */
  async getConsultationHistory(
    practitionerId: number,
    status?: ConsultationStatus,
  ): Promise<ConsultationHistoryItemDto[]> {
    const whereClause: any = { ownerId: practitionerId };
    if (status) {
      whereClause.status = status;
    } else {
      whereClause.status = ConsultationStatus.COMPLETED;
    }

    const consults = await this.db.consultation.findMany({
      where: whereClause,
      include: {
        participants: {
          include: { user: true },
        },
      },
      orderBy: { closedAt: 'desc' },
    });
    return consults.map((c) => this.mapToHistoryItem(c));
  }

  /**
   * Fetch full details of one consultation.
   */
  async getConsultationDetails(id: number): Promise<ConsultationDetailDto> {
    const c = await this.db.consultation.findUnique({
      where: { id },
      include: {
        participants: { include: { user: true } },
        messages: true,
      },
    });
    if (!c) throw HttpExceptionHelper.notFound('Consultation not found');
    const base = this.mapToHistoryItem(c);
    return {
      ...base,
      messages: c.messages.map((m) => ({
        id: m.id,
        userId: m.userId,
        content: m.content,
        consultationId: m.consultationId,
      })),
    };
  }

  /**
   * Download consultation PDF (dummy implementation).
   */
  async downloadConsultationPdf(id: number): Promise<Buffer> {
    const c = await this.db.consultation.findUnique({ where: { id } });
    if (!c) throw HttpExceptionHelper.notFound('Consultation not found');
    const dummyPdf = Buffer.from('%PDF-1.4\n%…', 'utf8');
    return dummyPdf;
  }

  /**
   * Internal: Map consultation to history item DTO.
   */
  private mapToHistoryItem(c: any): ConsultationHistoryItemDto {
    const start = c.startedAt || c.createdAt;
    const end = c.closedAt || new Date();
    const diffMs = end.getTime() - new Date(start).getTime();
    const mins = Math.floor(diffMs / 60000);
    const secs = Math.floor((diffMs % 60000) / 1000);
    const duration = mins ? `${mins}m ${secs}s` : `${secs}s`;

    const feedbacks = c.participants
      .map((p) => p.feedbackRate)
      .filter((r) => typeof r === 'number');
    const avgFeedback =
      feedbacks.length > 0
        ? feedbacks.reduce((a, b) => a + b, 0) / feedbacks.length
        : undefined;

    const patientPart = c.participants.find((p) => p.user.role === 'PATIENT');
    return {
      consultation: {
        id: c.id,
        scheduledDate: c.scheduledDate,
        createdAt: c.createdAt,
        startedAt: c.startedAt,
        closedAt: c.closedAt,
        createdBy: c.createdBy,
        groupId: c.groupId,
        ownerId: c.ownerId,
        messageService: c.messageService,
        whatsappTemplateId: c.whatsappTemplateId,
        status: c.status,
      },
      patient: patientPart
        ? {
            id: patientPart.user.id,
            role: patientPart.user.role,
            firstName: patientPart.user.firstName,
            lastName: patientPart.user.lastName,
            phoneNumber: patientPart.user.phoneNumber,
            country: patientPart.user.country,
            sex: patientPart.user.sex,
            status: patientPart.user.status,
          }
        : ({} as any),
      duration,
    };
  }

  async getOpenConsultations(
    practitionerId: number,
    page: number = 1,
    limit: number = 10,
  ): Promise<ApiResponseDto<OpenConsultationResponseDto>> {
    const practitioner = await this.db.user.findUnique({
      where: { id: practitionerId },
    });
    if (!practitioner) {
      throw HttpExceptionHelper.notFound('Practitioner not found');
    }
    if (practitioner.role !== UserRole.PRACTITIONER) {
      throw HttpExceptionHelper.forbidden('User is not a practitioner');
    }

    const skip = (page - 1) * limit;

    const total = await this.db.consultation.count({
      where: {
        ownerId: practitionerId,
        closedAt: null,
        startedAt: { not: null },
      },
    });

    const consultations = await this.db.consultation.findMany({
      where: {
        ownerId: practitionerId,
        closedAt: null,
        startedAt: { not: null },
      },
      include: {
        participants: {
          include: {
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                sex: true,
                role: true,
              },
            },
          },
        },
        group: {
          select: {
            name: true,
          },
        },
        messages: {
          take: 1,
          orderBy: { id: 'desc' },
          select: {
            content: true,
          },
        },
      },
      orderBy: { startedAt: 'desc' },
      skip,
      take: limit,
    });

    const consultationItems: OpenConsultationItemDto[] = consultations.map(
      (consultation) => {
        const patientParticipant = consultation.participants.find(
          (p) => p.user.role === UserRole.PATIENT,
        );

        const patient = patientParticipant?.user;
        const activeParticipants = consultation.participants.filter(
          (p) => p.isActive,
        ).length;

        const patientDto: OpenConsultationPatientDto = {
          id: patient?.id || 0,
          firstName: patient?.firstName || null,
          lastName: patient?.lastName || null,
          initials: patient
            ? `${patient.firstName?.[0] || ''}${patient.lastName?.[0] || ''}`
            : 'N/A',
          sex: patient?.sex || null,
          isOffline: patientParticipant ? !patientParticipant.isActive : true,
        };

        const timeSinceStart = this.calculateTimeSinceStart(
          consultation.startedAt!,
        );

        return {
          id: consultation.id,
          patient: patientDto,
          timeSinceStart,
          participantCount: activeParticipants,
          lastMessage: consultation.messages[0]?.content || null,
          status: consultation.status,
          startedAt: consultation.startedAt!,
          groupName: consultation.group?.name || null,
        };
      },
    );

    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;

    const responseData: OpenConsultationResponseDto = {
      consultations: consultationItems,
      total,
      currentPage: page,
      totalPages,
      limit,
      hasNextPage,
      hasPreviousPage,
    };

    return ApiResponseDto.success(
      responseData,
      'Open consultations fetched successfully',
      200,
    );
  }

  async joinOpenConsultation(
    consultationId: number,
    practitionerId: number,
  ): Promise<ApiResponseDto<JoinOpenConsultationResponseDto>> {
    const consultation = await this.db.consultation.findUnique({
      where: { id: consultationId },
      include: {
        participants: {
          where: { userId: practitionerId },
        },
      },
    });

    if (!consultation) {
      throw HttpExceptionHelper.notFound('Consultation not found');
    }

    if (consultation.ownerId !== practitionerId) {
      throw HttpExceptionHelper.forbidden(
        'Not authorized to join this consultation',
      );
    }

    if (consultation.closedAt) {
      throw HttpExceptionHelper.badRequest('Cannot join a closed consultation');
    }

    if (!consultation.startedAt) {
      throw HttpExceptionHelper.badRequest('Consultation has not started yet');
    }

    await this.db.participant.upsert({
      where: {
        consultationId_userId: { consultationId, userId: practitionerId },
      },
      create: {
        consultationId,
        userId: practitionerId,
        isActive: true,
        joinedAt: new Date(),
      },
      update: {
        isActive: true,
        joinedAt: new Date(),
      },
    });

    if (this.wsServer) {
      this.wsServer
        .to(`consultation:${consultationId}`)
        .emit('practitioner_rejoined', {
          consultationId,
          practitionerId,
          timestamp: new Date(),
        });
    }

    const responseData: JoinOpenConsultationResponseDto = {
      success: true,
      statusCode: 200,
      message: 'Successfully rejoined consultation',
      consultationId,
      sessionUrl: `/consultation/session/${consultationId}`, 
    };

    return ApiResponseDto.success(
      responseData,
      responseData.message,
      responseData.statusCode,
    );
  }

  async closeConsultation(
    consultationId: number,
    practitionerId: number,
    reason?: string,
  ): Promise<ApiResponseDto<CloseConsultationResponseDto>> {
    const consultation = await this.db.consultation.findUnique({
      where: { id: consultationId },
      include: {
        participants: true,
      },
    });

    if (!consultation) {
      throw HttpExceptionHelper.notFound('Consultation not found');
    }

    if (consultation.ownerId !== practitionerId) {
      throw HttpExceptionHelper.forbidden(
        'Not authorized to close this consultation',
      );
    }

    if (consultation.closedAt) {
      throw HttpExceptionHelper.badRequest('Consultation is already closed');
    }

    const closedAt = new Date();

    const updatedConsultation = await this.db.consultation.update({
      where: { id: consultationId },
      data: {
        status: ConsultationStatus.COMPLETED,
        closedAt,
      },
    });

    await this.db.participant.updateMany({
      where: { consultationId },
      data: { isActive: false },
    });

    if (this.wsServer) {
      this.wsServer
        .to(`consultation:${consultationId}`)
        .emit('consultation_closed', {
          consultationId,
          closedBy: practitionerId,
          reason: reason || 'Consultation ended by practitioner',
          closedAt,
        });

      consultation.participants.forEach((participant) => {
        this.wsServer
          .to(`user:${participant.userId}`)
          .emit('consultation_ended', {
            consultationId,
            message: 'The consultation has been ended by the practitioner',
          });
      });
    }

    const responseData: CloseConsultationResponseDto = {
      success: true,
      statusCode: 200,
      message: 'Consultation closed successfully',
      consultationId,
      closedAt,
    };

    return ApiResponseDto.success(
      responseData,
      responseData.message,
      responseData.statusCode,
    );
  }


  private calculateTimeSinceStart(startedAt: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - new Date(startedAt).getTime();

    const minutes = Math.floor(diffMs / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ago`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ago`;
    } else if (minutes > 0) {
      return `${minutes}m ago`;
    } else {
      return 'Just started';
    }
  }

  async getOpenConsultationDetails(
    consultationId: number,
    practitionerId: number,
  ): Promise<ConsultationDetailDto> {
    // Verify practitioner has access to this consultation
    const consultation = await this.db.consultation.findUnique({
      where: { id: consultationId },
      select: { ownerId: true, closedAt: true },
    });

    if (!consultation) {
      throw HttpExceptionHelper.notFound('Consultation not found');
    }

    if (consultation.ownerId !== practitionerId) {
      throw HttpExceptionHelper.forbidden(
        'Not authorized to view this consultation',
      );
    }

    if (consultation.closedAt) {
      throw HttpExceptionHelper.badRequest('Consultation is already closed');
    }

    return this.getConsultationDetails(consultationId);
  }
}
