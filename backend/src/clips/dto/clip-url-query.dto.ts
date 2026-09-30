import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';

export class ClipUrlQueryDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  reframe?: boolean;
}
