import { Transform, Type } from 'class-transformer';
import { IsNumber, IsString, MaxLength, Min, MinLength } from 'class-validator';

export class CreateClipDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @MinLength(1, { message: 'title must not be empty' })
  @MaxLength(255)
  title!: string;

  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  startSec!: number;

  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  endSec!: number;
}
