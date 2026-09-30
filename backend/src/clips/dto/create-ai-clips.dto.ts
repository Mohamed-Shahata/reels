import { IsBoolean, IsOptional } from 'class-validator';

export class CreateAiClipsDto {
  @IsOptional()
  @IsBoolean()
  confirmReplace?: boolean;
}
