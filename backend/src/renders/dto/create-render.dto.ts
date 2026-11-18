import { IsBoolean, IsIn, IsOptional } from 'class-validator';
import { SubtitleStyleQueryDto } from '../../subtitles/dto/subtitle-style-query.dto';

export const RENDER_QUALITIES = ['1080p', '720p', '1080', '720'] as const;
export type RenderQuality = (typeof RENDER_QUALITIES)[number];

export class CreateRenderDto extends SubtitleStyleQueryDto {
  @IsOptional()
  @IsBoolean()
  subtitles?: boolean;

  @IsOptional()
  @IsIn(RENDER_QUALITIES)
  quality?: RenderQuality;
}
