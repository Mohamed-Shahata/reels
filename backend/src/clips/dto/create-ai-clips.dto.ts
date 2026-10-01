import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import {
  AI_CLIP_MODES,
  type AiClipMode,
} from '../../segmentation/ai-clip-mode';

export class CreateAiClipsDto {
  @IsOptional()
  @IsBoolean()
  confirmReplace?: boolean;

  /** FULL cuts the whole episode; HIGHLIGHTS keeps only the best moments. */
  @IsOptional()
  @IsIn(AI_CLIP_MODES)
  mode?: AiClipMode;
}
