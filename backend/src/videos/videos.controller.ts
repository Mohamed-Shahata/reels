import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { Public } from '../auth/public.decorator';
import { CreateVideoDto } from './dto/create-video.dto';
import { CompleteVideoDto } from './dto/complete-video.dto';
import { PresignPartsDto } from './dto/presign-parts.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { VideosService } from './videos.service';

@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Get('upload-constraints')
  constraints() {
    return this.videos.getUploadConstraints();
  }

  @Get('library')
  library(@CurrentUser() auth: AuthContext) {
    return this.videos.listLibrary(auth.userId);
  }

  @Get()
  list(@CurrentUser() auth: AuthContext) {
    return this.videos.list(auth.userId);
  }

  @Get(':id/playback')
  async playback(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return { url: await this.videos.getPlaybackUrl(auth.userId, id) };
  }

  @Public()
  @Get(':id/thumbnail')
  async thumbnail(@Param('id') id: string, @Res() res: Response) {
    return this.videos.serveThumbnail(id, res);
  }

  @Get(':id/processing')
  async getProcessingStatus(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
  ) {
    return this.videos.getProcessingJobs(auth.userId, id);
  }

  @Get(':id/jobs')
  async getJobs(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.videos.getProcessingJobs(auth.userId, id);
  }

  @Get(':id/transcript')
  async getTranscript(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
  ) {
    return this.videos.getTranscript(auth.userId, id);
  }

  @Get(':id/transcript.:format')
  async exportTranscript(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Param('format') format: string,
    @Res() res: Response,
  ) {
    const lower = format?.toLowerCase();
    if (lower !== 'srt' && lower !== 'vtt' && lower !== 'txt') {
      throw new BadRequestException(
        `Unsupported transcript format "${format}". Use srt, vtt, or txt.`,
      );
    }

    const { content, filename, contentType } =
      await this.videos.exportTranscript(auth.userId, id, lower);

    res.setHeader('Content-Type', contentType);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    return res.send(content);
  }

  @Get(':id/reframe')
  async getReframePlan(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
  ) {
    return this.videos.getReframePlan(auth.userId, id);
  }

  @Get(':id')
  async findOne(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.videos.findOne(auth.userId, id);
  }

  @Post(':id/transcribe')
  async transcribe(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.videos.startTranscription(auth.userId, id);
  }

  @Post()
  create(@CurrentUser() auth: AuthContext, @Body() dto: CreateVideoDto) {
    return this.videos.createUpload(auth.userId, dto.title, dto);
  }

  @Get(':id/upload')
  async getUploadStatus(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Query('uploadId') uploadId?: string,
  ) {
    return this.videos.getUploadStatus(auth.userId, id, uploadId);
  }

  @Post(':id/upload/parts')
  @HttpCode(HttpStatus.OK)
  async presignParts(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: PresignPartsDto,
  ) {
    return this.videos.presignParts(
      auth.userId,
      id,
      dto.uploadId,
      dto.partNumbers,
    );
  }

  @Post(':id/upload-signature')
  @HttpCode(HttpStatus.OK)
  resume(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.videos.resumeUpload(auth.userId, id);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  complete(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: CompleteVideoDto,
  ) {
    return this.videos.completeUpload(auth.userId, id, dto);
  }

  @Patch(':id')
  rename(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: UpdateVideoDto,
  ) {
    return this.videos.rename(auth.userId, id, dto.title);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.ACCEPTED)
  async remove(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    await this.videos.remove(auth.userId, id);
  }
}
