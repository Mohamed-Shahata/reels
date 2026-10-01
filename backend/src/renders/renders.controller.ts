import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Body,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { CreateClipRenderDto } from './dto/create-clip-render.dto';
import { CreateRenderDto } from './dto/create-render.dto';
import { RendersService } from './renders.service';

@Controller()
export class RendersController {
  constructor(private readonly renders: RendersService) {}

  @Post('clips/:clipId/renders')
  @HttpCode(HttpStatus.ACCEPTED)
  create(
    @CurrentUser() auth: AuthContext,
    @Param('clipId') clipId: string,
    @Body() dto: CreateClipRenderDto,
  ) {
    return this.renders.create(auth.userId, clipId, dto);
  }

  @Get('clips/:clipId/renders')
  list(@CurrentUser() auth: AuthContext, @Param('clipId') clipId: string) {
    return this.renders.list(auth.userId, clipId);
  }

  @Post('videos/:videoId/renders')
  @HttpCode(HttpStatus.ACCEPTED)
  createForVideo(
    @CurrentUser() auth: AuthContext,
    @Param('videoId') videoId: string,
    @Body() dto: CreateRenderDto,
  ) {
    return this.renders.createForVideo(auth.userId, videoId, dto);
  }

  @Get('videos/:videoId/renders')
  listForVideo(
    @CurrentUser() auth: AuthContext,
    @Param('videoId') videoId: string,
  ) {
    return this.renders.listForVideo(auth.userId, videoId);
  }

  @Delete('videos/:videoId/renders/subtitled')
  deleteSubtitledForVideo(
    @CurrentUser() auth: AuthContext,
    @Param('videoId') videoId: string,
  ) {
    return this.renders.deleteSubtitledRenders(auth.userId, { videoId });
  }

  @Delete('clips/:clipId/renders/subtitled')
  deleteSubtitledForClip(
    @CurrentUser() auth: AuthContext,
    @Param('clipId') clipId: string,
  ) {
    return this.renders.deleteSubtitledRenders(auth.userId, { clipId });
  }

  @Post('clips/:clipId/renders/stop')
  @HttpCode(HttpStatus.OK)
  stopForClip(
    @CurrentUser() auth: AuthContext,
    @Param('clipId') clipId: string,
  ) {
    return this.renders.stopForClip(auth.userId, clipId);
  }

  @Post('videos/:videoId/renders/stop')
  @HttpCode(HttpStatus.OK)
  stopForVideo(
    @CurrentUser() auth: AuthContext,
    @Param('videoId') videoId: string,
  ) {
    return this.renders.stopForVideo(auth.userId, videoId);
  }

  @Post('renders/:renderId/stop')
  @HttpCode(HttpStatus.OK)
  stop(@CurrentUser() auth: AuthContext, @Param('renderId') renderId: string) {
    return this.renders.stop(auth.userId, renderId);
  }

  @Get('renders/:renderId/download')
  async download(
    @CurrentUser() auth: AuthContext,
    @Param('renderId') renderId: string,
  ) {
    return { url: await this.renders.getDownloadUrl(auth.userId, renderId) };
  }

  @Post('renders/:renderId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(@CurrentUser() auth: AuthContext, @Param('renderId') renderId: string) {
    return this.renders.retry(auth.userId, renderId);
  }
}
