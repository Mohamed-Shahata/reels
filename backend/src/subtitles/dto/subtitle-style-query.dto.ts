import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  HEX_COLOR_PATTERN,
  SUBTITLE_DISPLAY_MODES,
  SUBTITLE_FONT_SIZE_LIMITS,
  SUBTITLE_FONTS,
  SUBTITLE_POSITIONS,
  SUBTITLE_PRESET_IDS,
  type SubtitleDisplayMode,
  type SubtitleFont,
  type SubtitlePosition,
  type SubtitlePresetId,
} from '../subtitle-style';

const HEX_COLOR_MESSAGE = 'must be a color like #ffffff';

export class SubtitleStyleQueryDto {
  @IsOptional()
  @IsIn(SUBTITLE_PRESET_IDS)
  preset?: SubtitlePresetId;

  @IsOptional()
  @IsIn(SUBTITLE_FONTS)
  fontFamily?: SubtitleFont;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(SUBTITLE_FONT_SIZE_LIMITS.min)
  @Max(SUBTITLE_FONT_SIZE_LIMITS.max)
  fontSizePx?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  @IsBoolean()
  bold?: boolean;

  @IsOptional()
  @Matches(HEX_COLOR_PATTERN, { message: `textColor ${HEX_COLOR_MESSAGE}` })
  textColor?: string;

  @IsOptional()
  @Matches(HEX_COLOR_PATTERN, {
    message: `backgroundColor ${HEX_COLOR_MESSAGE}`,
  })
  backgroundColor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  @Max(1)
  backgroundOpacity?: number;

  @IsOptional()
  @IsIn(SUBTITLE_POSITIONS)
  position?: SubtitlePosition;

  @IsOptional()
  @IsIn(SUBTITLE_DISPLAY_MODES)
  displayMode?: SubtitleDisplayMode;
}
