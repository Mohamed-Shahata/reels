import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

@Injectable()
export class RequestLoggerMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(request: Request, response: Response, next: NextFunction): void {
    const incoming = request.headers['x-request-id'];
    const requestId =
      typeof incoming === 'string' &&
      incoming.length > 0 &&
      incoming.length <= 128
        ? incoming
        : randomUUID();

    request.headers['x-request-id'] = requestId;
    response.setHeader('x-request-id', requestId);

    const startedAt = process.hrtime.bigint();

    response.on('finish', () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
      this.logger.log(
        `${request.method} ${request.originalUrl} ${response.statusCode} ${durationMs.toFixed(1)}ms id=${requestId}`,
      );
    });

    next();
  }
}
