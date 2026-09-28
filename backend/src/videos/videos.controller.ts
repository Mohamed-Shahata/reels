import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { CreateVideoDto } from './dto/create-video.dto';
import { VideosService } from './videos.service';

@Controller('videos')
export class VideosController {
  constructor(private readonly videos: VideosService) {}

  @Post()
  create(@CurrentUser() auth: AuthContext, @Body() dto: CreateVideoDto) {
    return this.videos.createUpload(auth.userId, dto.title);
  }

  @Post(':id/upload-signature')
  @HttpCode(HttpStatus.OK)
  resume(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    return this.videos.resumeUpload(auth.userId, id);
  }
}
