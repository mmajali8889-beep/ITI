import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';

import { CreateRadiologyOrderDto } from './dto/create-radiology-order.dto';

import { UpdateRadiologyOrderStatusDto } from './dto/update-radiology-order-status.dto';

import { UpdateRadiologyWorkflowDto } from './dto/update-radiology-workflow.dto';

import { RadiologyWorklistQueryDto } from './dto/radiology-worklist-query.dto';

import { AssignRadiologistDto } from './dto/assign-radiologist.dto';

import { RadiologyService } from './radiology.service';

@Controller('api/radiology')
export class RadiologyController {
  constructor(private readonly radiologyService: RadiologyService) {}

  @Post('orders')
  createOrder(
    @Body()
    dto: CreateRadiologyOrderDto,
  ) {
    return this.radiologyService.createOrder(dto);
  }

  @Get('orders')
  getAllOrders(
    @Query()
    query: RadiologyWorklistQueryDto,
  ) {
    return this.radiologyService.getAllOrders(query);
  }

  @Get('orders/by-accession/:accessionNumber')
  getOrderByAccession(
    @Param('accessionNumber')
    accessionNumber: string,
  ) {
    return this.radiologyService.getOrderByAccession(accessionNumber);
  }

  @Get('orders/:orderId')
  getOrder(
    @Param('orderId')
    orderId: string,
  ) {
    return this.radiologyService.getOrder(orderId);
  }

  @Get('encounter/:encounterId')
  getEncounterOrders(
    @Param('encounterId')
    encounterId: string,
  ) {
    return this.radiologyService.getEncounterOrders(encounterId);
  }

  @Get('patient/:patientId')
  getPatientOrders(
    @Param('patientId')
    patientId: string,
  ) {
    return this.radiologyService.getPatientOrders(patientId);
  }

  @Patch('orders/:orderId/status')
  updateStatus(
    @Param('orderId')
    orderId: string,

    @Body()
    dto: UpdateRadiologyOrderStatusDto,
  ) {
    return this.radiologyService.updateOrderStatus(
      orderId,
      dto.status,
      dto.hospitalId,
    );
  }

  @Patch('orders/:orderId/workflow')
  updateWorkflow(
    @Param('orderId')
    orderId: string,

    @Body()
    dto: UpdateRadiologyWorkflowDto,
  ) {
    return this.radiologyService.updateWorkflowStatus(
      orderId,
      dto.workflowStatus,
    );
  }

  @Patch('orders/:orderId/assignment')
  assignRadiologist(
    @Param('orderId')
    orderId: string,

    @Body()
    dto: AssignRadiologistDto,
  ) {
    return this.radiologyService.assignRadiologist(orderId, dto);
  }

  @Delete('orders/:orderId/assignment')
  unassignRadiologist(
    @Param('orderId')
    orderId: string,

    @Query('hospitalId')
    hospitalId: string,
  ) {
    return this.radiologyService.unassignRadiologist(orderId, hospitalId);
  }
}
