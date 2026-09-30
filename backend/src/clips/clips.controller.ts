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
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator';
import type { AuthContext } from '../auth/jwt-auth.guard';
import { ClipsService } from './clips.service';
import { AiClipRunsService } from './ai-clip-runs.service';
import { ClipUrlQueryDto } from './dto/clip-url-query.dto';
import { CreateAiClipsDto } from './dto/create-ai-clips.dto';
import { CreateClipDto } from './dto/create-clip.dto';
import { UpdateClipDto } from './dto/update-clip.dto';
import { SplitClipDto } from './dto/split-clip.dto';
import { MergeClipsDto } from './dto/merge-clips.dto';

@Controller()
export class ClipsController {
  constructor(
    private readonly clips: ClipsService,
    private readonly aiRuns: AiClipRunsService,
  ) {}

  @Post('videos/:videoId/clips')
  create(
    @CurrentUser() auth: AuthContext,
    @Param('videoId') videoId: string,
    @Body() dto: CreateClipDto,
  ) {
    return this.clips.create(auth.userId, videoId, dto);
  }

  @Post('videos/:videoId/ai-clips')
  createAiSuggestions(
    @CurrentUser() auth: AuthContext,
    @Param('videoId') videoId: string,
    @Body() dto: CreateAiClipsDto,
  ) {
    return this.aiRuns.run(auth.userId, videoId, dto);
  }

  @Get('videos/:videoId/ai-runs')
  listAiRuns(
    @CurrentUser() auth: AuthContext,
    @Param('videoId') videoId: string,
  ) {
    return this.clips.listAiRuns(auth.userId, videoId);
  }

  @Post('videos/:videoId/clips/merge')
  merge(
    @CurrentUser() auth: AuthContext,
    @Param('videoId') videoId: string,
    @Body() dto: MergeClipsDto,
  ) {
    return this.clips.merge(auth.userId, videoId, dto);
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

  @Post('clips/:id/split')
  split(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Body() dto: SplitClipDto,
  ) {
    return this.clips.split(auth.userId, id, dto);
  }

  @Get('clips/:id/playback')
  async playback(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Query() query: ClipUrlQueryDto,
  ) {
    return {
      url: await this.clips.getPlaybackUrl(auth.userId, id, {
        reframe: query.reframe,
      }),
    };
  }

  @Get('clips/:id/download')
  async download(
    @CurrentUser() auth: AuthContext,
    @Param('id') id: string,
    @Query() query: ClipUrlQueryDto,
  ) {
    return {
      url: await this.clips.getDownloadUrl(auth.userId, id, {
        reframe: query.reframe,
      }),
    };
  }

  @Delete('clips/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() auth: AuthContext, @Param('id') id: string) {
    await this.clips.remove(auth.userId, id);
  }
}
