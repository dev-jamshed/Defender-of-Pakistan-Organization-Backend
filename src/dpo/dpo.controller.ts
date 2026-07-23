import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AdminAuthGuard } from './auth.guard';
import { DpoService } from './dpo.service';
import type { ListQuery, ResourceName } from './dpo.types';

@Controller('api')
export class DpoController {
  constructor(private readonly dpoService: DpoService) {}

  @Get('health')
  health() {
    return this.dpoService.getHealth();
  }

  @Post('auth/login')
  login(@Body() body: { email?: string; password?: string }) {
    return this.dpoService.login(body.email ?? '', body.password ?? '');
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin/schemas')
  schemas() {
    return this.dpoService.getSchemas();
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin/dashboard')
  dashboard() {
    return this.dpoService.getDashboard();
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin/database/status')
  databaseStatus() {
    return this.dpoService.getDatabaseStatus();
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin/:resource')
  list(@Param('resource') resource: string, @Query() query: ListQuery) {
    return this.dpoService.list(resource as ResourceName, query);
  }

  @UseGuards(AdminAuthGuard)
  @Post('admin/:resource')
  create(
    @Param('resource') resource: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.dpoService.create(resource as ResourceName, body);
  }

  @UseGuards(AdminAuthGuard)
  @Get('admin/:resource/:id')
  get(@Param('resource') resource: string, @Param('id') id: string) {
    return this.dpoService.get(resource as ResourceName, id);
  }

  @UseGuards(AdminAuthGuard)
  @Patch('admin/:resource/:id')
  update(
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.dpoService.update(resource as ResourceName, id, body);
  }

  @UseGuards(AdminAuthGuard)
  @Delete('admin/:resource/:id')
  delete(@Param('resource') resource: string, @Param('id') id: string) {
    return this.dpoService.delete(resource as ResourceName, id);
  }

  @UseGuards(AdminAuthGuard)
  @Post('admin/:resource/:id/actions/:action')
  action(
    @Param('resource') resource: string,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.dpoService.runAction(
      resource as ResourceName,
      id,
      action,
      body,
    );
  }

  @Get('public/verify/member/:membershipNumber')
  verifyMember(@Param('membershipNumber') membershipNumber: string) {
    return this.dpoService.verifyMember(membershipNumber);
  }

  @Get('public/verify/wireless/:imei')
  verifyWirelessDevice(@Param('imei') imei: string) {
    return this.dpoService.verifyWirelessDevice(imei);
  }

  @Post('public/complaints')
  submitComplaint(@Body() body: Record<string, unknown>) {
    return this.dpoService.create('complaints', {
      complaintNumber: `CMP-${Date.now()}`,
      status: 'pending',
      priority: body.priority ?? 'medium',
      ...body,
    });
  }

  @Get('public/complaints/:complaintNumber')
  trackComplaint(@Param('complaintNumber') complaintNumber: string) {
    return this.dpoService.trackComplaint(complaintNumber);
  }

  @Get('public/cms')
  publicCms() {
    return this.dpoService.getPublicCms();
  }

  @Get('public/gallery')
  publicGallery() {
    return this.dpoService.getPublicGallery();
  }

  @Get('public/welfare')
  publicWelfare() {
    return this.dpoService.getPublicWelfare();
  }
}
