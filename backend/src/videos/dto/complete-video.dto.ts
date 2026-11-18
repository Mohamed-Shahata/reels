import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class CompleteUploadPartDto {
  @IsInt()
  @Min(1)
  partNumber!: number;

  @IsString()
  eTag!: string;
}

export class CompleteVideoDto {
  @IsOptional()
  @IsString()
  uploadId?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompleteUploadPartDto)
  parts?: CompleteUploadPartDto[];

  @IsOptional()
  @IsString()
  @MaxLength(255)
  publicId?: string;
}
