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
import { CreateVideoDto } from './dto/create-video.dto';
import { CompleteVideoDto } from './dto/complete-video.dto';
import { UpdateVideoDto } from './dto/update-video.dto';
import { VideosService } from './videos.service';

@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Get('upload-constraints')
  constraints() {
    return this.videos.getUploadConstraints();
  }

  @Get()
  list(@CurrentUser() auth: AuthContext) {
    return this.videos.list(auth.userId);
  }

  @Post()
  create(@CurrentUser() auth: AuthContext, @Body() dto: CreateVideoDto) {
    return this.videos.createUpload(auth.userId, dto.title);
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
    return this.videos.completeUpload(auth.userId, id, dto.publicId);
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
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    await this.videos.remove(auth.userId, id);
  }
}
