import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { CheckInAppointmentDto, CreateAppointmentDto, CreateScheduleDto, GenerateSlotsDto, RescheduleAppointmentDto, UpdateAppointmentStatusDto } from './dto/appointment.dto';
import { SchedulingService } from './scheduling.service';

@Controller('api/appointments')
export class AppointmentsController {
  constructor(private readonly service: AppointmentsService, private readonly scheduling: SchedulingService) {}
  @Post('schedules') createSchedule(@Body() dto: CreateScheduleDto) { return this.scheduling.createSchedule(dto); }
  @Post('schedules/:scheduleId/slots') generateSlots(@Param('scheduleId') id:string,@Body() dto:GenerateSlotsDto){return this.scheduling.generateSlots(id,dto);}
  @Get('slots/available') available(@Query('hospitalId') hospitalId:string,@Query('date') date?:string,@Query('practitionerId') practitionerId?:string,@Query('specialty') specialty?:string){return this.scheduling.available(hospitalId,date,practitionerId,specialty);}

  @Get()
  list(@Query('hospitalId') hospitalId: string, @Query('date') date?: string, @Query('status') status?: string) {
    return this.service.list(hospitalId, date, status);
  }

  @Post()
  create(@Body() dto: CreateAppointmentDto) { return this.service.create(dto); }

  @Patch(':appointmentId/status')
  updateStatus(@Param('appointmentId') appointmentId: string, @Body() dto: UpdateAppointmentStatusDto) {
    return this.service.updateStatus(appointmentId, dto);
  }

  @Post(':appointmentId/check-in')
  checkIn(@Param('appointmentId') appointmentId: string, @Body() dto: CheckInAppointmentDto) {
    return this.service.checkIn(appointmentId, dto);
  }
  @Post(':appointmentId/reschedule') reschedule(@Param('appointmentId') id:string,@Body() dto:RescheduleAppointmentDto){return this.service.reschedule(id,dto);}
}
