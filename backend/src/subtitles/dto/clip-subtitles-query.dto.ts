import { IsIn, IsOptional } from 'class-validator';
import {
  SUBTITLE_DISPLAY_MODES,
  type SubtitleDisplayMode,
} from '../subtitle-style';

export class ClipSubtitlesQueryDto {
  @IsOptional()
  @IsIn(SUBTITLE_DISPLAY_MODES)
  mode?: SubtitleDisplayMode;
}
