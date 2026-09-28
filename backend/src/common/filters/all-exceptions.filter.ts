import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { STATUS_CODES } from 'node:http';

export interface ErrorResponseBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  path: string;
  requestId?: string;
  timestamp: string;
}

interface NormalizedError {
  statusCode: number;
  message: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const { statusCode, message, details } = this.normalize(exception);
    const requestId = request.headers['x-request-id'];

    if (statusCode >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} failed: ${
          exception instanceof Error ? exception.message : 'unknown error'
        }`,
        exception instanceof Error ? exception.stack : undefined,
      );
    }

    const body: ErrorResponseBody = {
      statusCode,
      error: STATUS_CODES[statusCode] ?? 'Error',
      message,
      ...(details !== undefined && { details }),
      path: request.originalUrl,
      ...(typeof requestId === 'string' && { requestId }),
      timestamp: new Date().toISOString(),
    };

    response.status(statusCode).json(body);
  }

  private normalize(exception: unknown): NormalizedError {
    if (!(exception instanceof HttpException)) {
      return {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      };
    }

    const statusCode = exception.getStatus();
    const payload = exception.getResponse();

    if (typeof payload === 'string') {
      return { statusCode, message: payload };
    }

    const { message, details } = payload as {
      message?: string | string[];
      details?: unknown;
    };

    if (Array.isArray(message)) {
      return { statusCode, message: 'Request failed', details: message };
    }

    return {
      statusCode,
      message: message ?? exception.message,
      details,
    };
  }
}
