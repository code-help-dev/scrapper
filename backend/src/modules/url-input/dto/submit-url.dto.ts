import { IsUrl, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class SubmitUrlDto {
  @ApiProperty({
    example: 'https://www.aajjo.com/supplier/example-supplier',
    description: 'Aajjo supplier or product page URL',
  })
  @IsUrl({ require_protocol: true }, { message: 'Must be a valid URL' })
  url: string;

  @ApiPropertyOptional({ description: 'Optional label / note for this job' })
  @IsOptional()
  label?: string;
}
