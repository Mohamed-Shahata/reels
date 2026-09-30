import { Controller, Get, Param, Query } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { SubtitleStyleQueryDto } from './dto/subtitle-style-query.dto';
import {
  getSubtitleStyleCatalog,
  resolveSubtitleStyle,
} from './subtitle-style';
import { SubtitlesService } from './subtitles.service';

@Controller()
export class SubtitlesController {
  constructor(private readonly subtitles: SubtitlesService) {}

  @Get('clips/:id/subtitles')
  getClipSubtitles(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.subtitles.getClipSubtitles(auth.userId, id);
  }

  @Get('subtitles/styles')
  getStyleCatalog() {
    return getSubtitleStyleCatalog();
  }

  @Get('subtitles/styles/resolve')
  resolveStyle(@Query() query: SubtitleStyleQueryDto) {
    const { preset, ...overrides } = query;
    return resolveSubtitleStyle(preset, overrides);
  }
}
