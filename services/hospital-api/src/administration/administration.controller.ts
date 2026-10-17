import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { Roles } from '../auth/roles.decorator';
import { AdministrationService } from './administration.service';
import {
  AssignRoleDto,
  CreateCatalogItemDto,
  CreateRoleDto,
  CreateUserProfileDto,
} from './dto/administration.dto';
@Roles('administrator', 'system-administrator')
@Controller('api/administration')
export class AdministrationController {
  constructor(private readonly service: AdministrationService) {}
  @Get('overview') overview(@Query('hospitalId') h: string) {
    return this.service.overview(h);
  }
  @Get('catalog') catalog(
    @Query('hospitalId') h: string,
    @Query('kind') k: string,
  ) {
    return this.service.catalog(h, k);
  }
  @Post('catalog') create(@Body() d: CreateCatalogItemDto) {
    return this.service.createCatalog(d);
  }
  @Get('roles') roles(@Query('hospitalId') h: string) {
    return this.service.roles(h);
  }
  @Post('roles') createRole(@Body() d: CreateRoleDto) {
    return this.service.createRole(d);
  }
  @Get('users') users(@Query('hospitalId') h: string) {
    return this.service.users(h);
  }
  @Post('users') createUser(@Body() d: CreateUserProfileDto) {
    return this.service.createUser(d);
  }
  @Post('role-assignments') assign(@Body() d: AssignRoleDto) {
    return this.service.assignRole(d);
  }
}
