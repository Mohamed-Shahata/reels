import { IsOptional, IsString, MaxLength } from 'class-validator';

export class CompleteVideoDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  publicId?: string;
}
