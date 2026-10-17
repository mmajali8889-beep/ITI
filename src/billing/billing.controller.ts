import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { AdjudicateClaimDto, CaptureEncounterChargesDto, CreateChargeDto, CreateInvoiceDto, CreateTariffDto, RecordPaymentDto, SubmitClaimDto } from './dto/billing.dto';
import { BillingService } from './billing.service';

@Controller('api/billing')
export class BillingController {
  constructor(private readonly service: BillingService) {}
  @Post('charges') createCharge(@Body() dto: CreateChargeDto) { return this.service.createCharge(dto); }
  @Post('invoices') createInvoice(@Body() dto: CreateInvoiceDto) { return this.service.createInvoice(dto); }
  @Get('encounters/:encounterId') encounterSummary(@Param('encounterId') encounterId: string, @Query('hospitalId') hospitalId: string) { return this.service.encounterSummary(encounterId, hospitalId); }
  @Post('invoices/:invoiceId/payments') recordPayment(@Param('invoiceId') invoiceId: string, @Body() dto: RecordPaymentDto) { return this.service.recordPayment(invoiceId, dto); }
  @Post('claims') submitClaim(@Body() dto: SubmitClaimDto) { return this.service.submitClaim(dto); }
  @Post('claims/:claimId/adjudications') adjudicate(@Param('claimId') claimId: string, @Body() dto: AdjudicateClaimDto) { return this.service.adjudicate(claimId, dto); }
  @Post('tariffs') tariff(@Body() dto:CreateTariffDto){return this.service.createTariff(dto);}
  @Get('tariffs') tariffs(@Query('hospitalId') hospitalId:string){return this.service.tariffs(hospitalId);}
  @Post('encounters/:encounterId/capture') capture(@Param('encounterId') encounterId:string,@Body() dto:CaptureEncounterChargesDto){return this.service.capture(encounterId,dto);}
  @Get('accounts/:patientId') account(@Param('patientId') patientId:string,@Query('hospitalId') hospitalId:string){return this.service.patientAccount(patientId,hospitalId);}
}
