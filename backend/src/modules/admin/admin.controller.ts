
import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength, IsBoolean } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { UserRole } from '../../common/enums/user-role.enum';
import { AdminService } from './admin.service';

class CreateUserDto {
  @ApiProperty() @IsEmail() email: string;
  @ApiProperty() @IsString() @MinLength(8) password: string;
  @ApiPropertyOptional({ enum: UserRole }) @IsOptional() @IsEnum(UserRole) role?: UserRole;
}

class UpdateUserDto {
  @ApiPropertyOptional({ enum: UserRole }) @IsOptional() @IsEnum(UserRole) role?: UserRole;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() active?: boolean;
}

@ApiTags('Admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.ADMIN)
@Controller('admin')
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('users')
  @ApiOperation({ summary: 'List all users with job counts' })
  async listUsers(): Promise<Array<Record<string, unknown>>> {
    return this.adminService.listUsers();
  }

  @Post('users')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create a new user (admin only)' })
  async createUser(@Body() dto: CreateUserDto) {
    return this.adminService.createUser(
      dto.email,
      dto.password,
      dto.role ?? UserRole.OPERATOR,
    );
  }

  @Patch('users/:id')
  @ApiOperation({ summary: 'Update user role or active status' })
  async updateUser(@Param('id') id: string, @Body() dto: UpdateUserDto) {
    return this.adminService.updateUser(id, dto);
  }

  @Get('overview')
  @ApiOperation({ summary: 'Per-user job metrics table (pending/running/completed/failed)' })
  async getOverview() {
    return this.adminService.getOverview();
  }

  @Get('users/:id/jobs')
  @ApiOperation({ summary: 'Job counts for a specific user' })
  async getUserJobCounts(@Param('id') id: string) {
    return this.adminService.getUserJobCounts(id);
  }
}
