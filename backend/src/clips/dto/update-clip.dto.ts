import { Transform, Type } from 'class-transformer';
import {
  IsNumber,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';

export class UpdateClipDto {
  @ValidateIf((_, value: unknown) => value !== undefined)
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'title must not be empty' })
  @MaxLength(255)
  title?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  startSec?: number;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  endSec?: number;
}
