import { IsBoolean, IsOptional } from 'class-validator';
import { SubtitleStyleQueryDto } from '../../subtitles/dto/subtitle-style-query.dto';

export class CreateRenderDto extends SubtitleStyleQueryDto {
  @IsOptional()
  @IsBoolean()
  subtitles?: boolean;
}
