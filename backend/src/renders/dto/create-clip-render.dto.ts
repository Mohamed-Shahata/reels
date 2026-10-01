import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
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
  /**
   * Throws away this clip's finished and failed subtitled renders first, so
   * the reel is rendered again from scratch instead of reusing the old one.
   */
  @IsOptional()
  @IsBoolean()
  regenerate?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_SUBTITLE_EDITS)
  @ValidateNested({ each: true })
  @Type(() => SubtitleEditDto)
  subtitleEdits?: SubtitleEditDto[];
}
