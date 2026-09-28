import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Env } from '../config/env.schema';

export interface AccessTokenPayload {
  sub: string;
  sid: string;
}

export interface ParsedRefreshToken {
  sessionId: string;
}

export interface IssuedRefreshToken {
  token: string;
  hash: string;
  expiresAt: Date;
}

@Injectable()
export class TokenService {
  private readonly accessTtlSec: number;
  private readonly refreshTtlSec: number;

  constructor(
    private readonly jwt: JwtService,
    config: ConfigService<Env, true>,
  ) {
    this.accessTtlSec = config.get('ACCESS_TOKEN_TTL_SEC', { infer: true });
    this.refreshTtlSec = config.get('REFRESH_TOKEN_TTL_SEC', { infer: true });
  }

  newSessionId(): string {
    return randomUUID();
  }

  signAccessToken(userId: string, sessionId: string): Promise<string> {
    const payload: AccessTokenPayload = { sub: userId, sid: sessionId };
    return this.jwt.signAsync(payload, { expiresIn: this.accessTtlSec });
  }

  issueRefreshToken(sessionId: string): IssuedRefreshToken {
    const secret = randomBytes(32).toString('base64url');
    const token = `${sessionId}.${secret}`;

    return {
      token,
      hash: this.hashRefreshToken(token),
      expiresAt: new Date(Date.now() + this.refreshTtlSec * 1000),
    };
  }

  parseRefreshToken(token: string): ParsedRefreshToken | null {
    const separator = token.indexOf('.');
    if (
      separator <= 0 ||
      separator === token.length - 1 ||
      token.length > 200
    ) {
      return null;
    }
    return { sessionId: token.slice(0, separator) };
  }

  verifyAccessToken(token: string): Promise<AccessTokenPayload> {
    return this.jwt.verifyAsync<AccessTokenPayload>(token);
  }

  hashRefreshToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
