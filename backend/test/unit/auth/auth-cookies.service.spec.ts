import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import type { Env } from '../../../src/config/env.schema';
import { AuthCookiesService } from '../../../src/auth/auth-cookies.service';

function setup(nodeEnv: string) {
  const values: Record<string, unknown> = {
    NODE_ENV: nodeEnv,
    ACCESS_TOKEN_TTL_SEC: 900,
    REFRESH_TOKEN_TTL_SEC: 3600,
  };
  const config = { get: (key: string) => values[key] };
  const cookie = jest.fn();
  const clearCookie = jest.fn();

  return {
    service: new AuthCookiesService(
      config as unknown as ConfigService<Env, true>,
    ),
    response: { cookie, clearCookie } as unknown as Response,
    cookie,
    clearCookie,
  };
}

describe('AuthCookiesService', () => {
  it('sets both cookies httpOnly with scoped paths and lifetimes', () => {
    const { service, response, cookie } = setup('development');

    service.setSession(response, { accessToken: 'a', refreshToken: 'r' });

    expect(cookie).toHaveBeenCalledWith('access_token', 'a', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/',
      maxAge: 900_000,
    });
    expect(cookie).toHaveBeenCalledWith('refresh_token', 'r', {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api/v1/auth',
      maxAge: 3_600_000,
    });
  });

  it('marks cookies secure in production', () => {
    const { service, response, cookie } = setup('production');

    service.setSession(response, { accessToken: 'a', refreshToken: 'r' });

    expect(cookie).toHaveBeenCalledWith(
      'access_token',
      'a',
      expect.objectContaining({ secure: true }),
    );
  });

  it('clears both cookies with the same scope they were set with', () => {
    const { service, response, clearCookie } = setup('production');

    service.clearSession(response);

    expect(clearCookie).toHaveBeenCalledWith('access_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
    expect(clearCookie).toHaveBeenCalledWith('refresh_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/api/v1/auth',
    });
  });

  it('reads tokens from request cookies and ignores empty or missing ones', () => {
    const { service } = setup('development');
    const request = {
      cookies: { access_token: 'a', refresh_token: '' },
    } as unknown as Request;

    expect(service.readAccessToken(request)).toBe('a');
    expect(service.readRefreshToken(request)).toBeUndefined();
    expect(service.readAccessToken({} as Request)).toBeUndefined();
  });
});
