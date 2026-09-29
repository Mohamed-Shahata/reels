import { Type } from 'class-transformer';
import { IsNumber, Min } from 'class-validator';

export class SplitClipDto {
  @Type(() => Number)
  @IsNumber({ allowInfinity: false, allowNaN: false })
  @Min(0)
  splitSec!: number;
}
