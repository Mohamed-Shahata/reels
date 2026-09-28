import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { ClipsService } from './clips.service';
import { CreateClipDto } from './dto/create-clip.dto';
import { UpdateClipDto } from './dto/update-clip.dto';

@Controller()
export class ClipsController {
  constructor(private readonly clips: ClipsService) {}

  @Post('videos/:videoId/clips')
  create(
    @CurrentUser() auth: AuthContext,
    @Param('videoId') videoId: string,
    @Body() dto: CreateClipDto,
  ) {
    return this.clips.create(auth.userId, videoId, dto);
  }

  @Get('videos/:videoId/clips')
  list(@CurrentUser() auth: AuthContext, @Param('videoId') videoId: string) {
    return this.clips.list(auth.userId, videoId);
  }

  @Patch('clips/:id')
  update(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateClipDto,
  ) {
    return this.clips.update(auth.userId, id, dto);
  }

  @Get('clips/:id/playback')
  async playback(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { url: await this.clips.getPlaybackUrl(auth.userId, id) };
  }

  @Get('clips/:id/download')
  async download(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { url: await this.clips.getDownloadUrl(auth.userId, id) };
  }

  @Delete('clips/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    await this.clips.remove(auth.userId, id);
  }
}
