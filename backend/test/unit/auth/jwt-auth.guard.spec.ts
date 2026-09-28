import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { AuthCookiesService } from '../../../src/auth/auth-cookies.service';
import {
  type AuthenticatedRequest,
  JwtAuthGuard,
} from '../../../src/auth/jwt-auth.guard';
import type { SessionsService } from '../../../src/auth/sessions.service';
import type { TokenService } from '../../../src/auth/token.service';

function setup(options: {
  cookie?: string;
  payload?: unknown;
  active?: boolean;
  isPublic?: boolean;
}) {
  const request = {} as AuthenticatedRequest;
  const context = {
    switchToHttp: () => ({ getRequest: () => request }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
  const cookies = { readAccessToken: () => options.cookie };
  const tokens = {
    verifyAccessToken: jest.fn(() =>
      options.payload === undefined
        ? Promise.reject(new Error('bad token'))
        : Promise.resolve(options.payload),
    ),
  };
  const sessions = { isActive: jest.fn().mockResolvedValue(options.active) };
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(options.isPublic),
  };
  const guard = new JwtAuthGuard(
    reflector as unknown as Reflector,
    cookies as unknown as AuthCookiesService,
    tokens as unknown as TokenService,
    sessions as unknown as SessionsService,
  );

  return { guard, context, request, sessions, tokens };
}

describe('JwtAuthGuard', () => {
  it('rejects a request without an access cookie', async () => {
    const { guard, context } = setup({});

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects an invalid or expired token', async () => {
    const { guard, context } = setup({ cookie: 'jwt' });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a valid token whose session was revoked', async () => {
    const { guard, context } = setup({
      cookie: 'jwt',
      payload: { sub: 'u1', sid: 's1' },
      active: false,
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('rejects a payload missing the session id', async () => {
    const { guard, context } = setup({
      cookie: 'jwt',
      payload: { sub: 'u1' },
      active: true,
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('attaches the auth context for a live session', async () => {
    const { guard, context, request, sessions } = setup({
      cookie: 'jwt',
      payload: { sub: 'u1', sid: 's1' },
      active: true,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(sessions.isActive).toHaveBeenCalledWith('s1', 'u1');
    expect(request.auth).toEqual({ userId: 'u1', sessionId: 's1' });
  });

  it('lets public routes through without checking any credentials', async () => {
    const { guard, context, sessions, tokens } = setup({ isPublic: true });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(tokens.verifyAccessToken).not.toHaveBeenCalled();
    expect(sessions.isActive).not.toHaveBeenCalled();
  });
});
