import { ConflictException, Injectable } from '@nestjs/common';
import { DEFAULT_AI_CLIP_MODE } from '../segmentation/ai-clip-mode';
import { TopicSegmentationService } from '../segmentation/topic-segmentation.service';
import { UsageService } from '../usage/usage.service';
import { ClipRecord, ClipsService } from './clips.service';
import type { CreateAiClipsDto } from './dto/create-ai-clips.dto';

@Injectable()
export class AiClipRunsService {
  constructor(
    private readonly clips: ClipsService,
    private readonly segmentation: TopicSegmentationService,
    private readonly usage: UsageService,
  ) {}

  async run(
    userId: string,
    videoId: string,
    dto: CreateAiClipsDto,
  ): Promise<ClipRecord[]> {
    const existingAiClips = await this.clips.countAiClips(userId, videoId);
    if (existingAiClips > 0 && dto.confirmReplace !== true) {
      throw new ConflictException(
        `This video already has ${existingAiClips} AI clips. Confirm the replacement to run AI again; clips you edited or created manually are kept.`,
      );
    }

    await this.segmentation.assertReady(userId, videoId);
    await this.usage.reserveAiRun(userId);

    const segments = await this.segmentation.suggest(
      userId,
      videoId,
      dto.mode ?? DEFAULT_AI_CLIP_MODE,
    );
    return this.clips.createAiSuggestions(userId, videoId, segments, {
      replaceExisting: existingAiClips > 0,
    });
  }
}
