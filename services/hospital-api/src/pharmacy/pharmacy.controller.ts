import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  AdministerMedicationDto,
  DispenseDto,
  ReceiveStockDto,
  ReturnDispenseDto,
  VerifyPrescriptionDto,
} from './dto/pharmacy.dto';
import { PharmacyService } from './pharmacy.service';
@Controller('api/pharmacy')
export class PharmacyController {
  constructor(private readonly service: PharmacyService) {}
  @Get('inventory') inventory(@Query('hospitalId') hospitalId: string) {
    return this.service.inventory(hospitalId);
  }
  @Post('inventory/receive') receive(@Body() dto: ReceiveStockDto) {
    return this.service.receive(dto);
  }
  @Get('queue') queue(@Query('hospitalId') hospitalId: string) {
    return this.service.queue(hospitalId);
  }
  @Post('prescriptions/:requestId/verify') verify(
    @Param('requestId') id: string,
    @Body() dto: VerifyPrescriptionDto,
  ) {
    return this.service.verifyPrescription(id, dto);
  }
  @Get('dispenses') dispenses(@Query('hospitalId') hospitalId: string) {
    return this.service.dispenses(hospitalId);
  }
  @Post('dispense') dispense(@Body() dto: DispenseDto) {
    return this.service.dispense(dto);
  }
  @Post('dispenses/:dispenseId/return') returnDispense(
    @Param('dispenseId') id: string,
    @Body() dto: ReturnDispenseDto,
  ) {
    return this.service.returnDispense(id, dto);
  }
  @Get('emar') emar(
    @Query('hospitalId') hospitalId: string,
    @Query('encounterId') encounterId: string,
  ) {
    return this.service.emar(hospitalId, encounterId);
  }
  @Post('emar/administer') administer(@Body() dto: AdministerMedicationDto) {
    return this.service.administer(dto);
  }
}
