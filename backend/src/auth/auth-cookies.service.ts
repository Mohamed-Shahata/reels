import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import { API_PREFIX } from '../app.setup';
import type { Env } from '../config/env.schema';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const REFRESH_COOKIE_PATH = `/${API_PREFIX}/auth`;

export interface SessionTokens {
  accessToken: string;
  refreshToken: string;
}

@Injectable()
export class AuthCookiesService {
  private readonly secure: boolean;
  private readonly sameSite: CookieOptions['sameSite'];
  private readonly accessTtlSec: number;
  private readonly refreshTtlSec: number;

  constructor(config: ConfigService<Env, true>) {
    this.secure = config.get('NODE_ENV', { infer: true }) === 'production';
    this.sameSite = config.get('COOKIE_SAME_SITE', { infer: true });
    this.accessTtlSec = config.get('ACCESS_TOKEN_TTL_SEC', { infer: true });
    this.refreshTtlSec = config.get('REFRESH_TOKEN_TTL_SEC', { infer: true });
  }

  setSession(response: Response, tokens: SessionTokens): void {
    response.cookie(
      ACCESS_COOKIE,
      tokens.accessToken,
      this.options('/', this.accessTtlSec),
    );
    response.cookie(
      REFRESH_COOKIE,
      tokens.refreshToken,
      this.options(REFRESH_COOKIE_PATH, this.refreshTtlSec),
    );
  }

  clearSession(response: Response): void {
    response.clearCookie(ACCESS_COOKIE, this.baseOptions('/'));
    response.clearCookie(REFRESH_COOKIE, this.baseOptions(REFRESH_COOKIE_PATH));
  }

  readAccessToken(request: Request): string | undefined {
    return this.read(request, ACCESS_COOKIE);
  }

  readRefreshToken(request: Request): string | undefined {
    return this.read(request, REFRESH_COOKIE);
  }

  private read(request: Request, name: string): string | undefined {
    const cookies = request.cookies as Record<string, unknown> | undefined;
    const value = cookies?.[name];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private baseOptions(path: string): CookieOptions {
    return {
      httpOnly: true,
      secure: this.secure,
      sameSite: this.sameSite,
      path,
    };
  }

  private options(path: string, ttlSec: number): CookieOptions {
    return { ...this.baseOptions(path), maxAge: ttlSec * 1000 };
  }
}
