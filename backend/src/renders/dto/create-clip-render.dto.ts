import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { MAX_SUBTITLE_EDIT_TEXT_LENGTH } from '../../subtitles/subtitle-edits';
import { CreateRenderDto } from './create-render.dto';

const MAX_SUBTITLE_EDITS = 500;

export class SubtitleEditDto {
  @IsInt()
  @Min(1)
  index!: number;

  @IsString()
  @MaxLength(MAX_SUBTITLE_EDIT_TEXT_LENGTH)
  text!: string;
}

export class CreateClipRenderDto extends CreateRenderDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SUBTITLE_EDITS)
  @ValidateNested({ each: true })
  @Type(() => SubtitleEditDto)
  subtitleEdits?: SubtitleEditDto[];
}
