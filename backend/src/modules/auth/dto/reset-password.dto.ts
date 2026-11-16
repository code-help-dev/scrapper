import { IsEmail, IsString, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ResetPasswordDto {
  @ApiProperty({ example: 'operator@eb2bmart.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'NewSecurePass123!', minLength: 6 })
  @IsString()
  @MinLength(6)
  newPassword: string;
}
