import { Inject } from '@nestjs/common';
import { PROCESSING_QUEUE } from './processing.constants';

export const InjectProcessingQueue = (): ParameterDecorator =>
  Inject(PROCESSING_QUEUE);
