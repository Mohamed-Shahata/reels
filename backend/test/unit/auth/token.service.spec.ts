import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { Env } from '../../../src/config/env.schema';
import { TokenService } from '../../../src/auth/token.service';

function createService(): { service: TokenService; jwt: JwtService } {
  const values: Record<string, unknown> = {
    ACCESS_TOKEN_TTL_SEC: 900,
    REFRESH_TOKEN_TTL_SEC: 3600,
  };
  const config = { get: (key: string) => values[key] };
  const jwt = new JwtService({ secret: 'x'.repeat(32) });

  return {
    service: new TokenService(
      jwt,
      config as unknown as ConfigService<Env, true>,
    ),
    jwt,
  };
}

describe('TokenService', () => {
  it('signs an access token carrying the user and session ids', async () => {
    const { service, jwt } = createService();

    const token = await service.signAccessToken('user-1', 'session-1');
    const payload = await jwt.verifyAsync<{
      sub: string;
      sid: string;
      exp: number;
      iat: number;
    }>(token);

    expect(payload.sub).toBe('user-1');
    expect(payload.sid).toBe('session-1');
    expect(payload.exp - payload.iat).toBe(900);
  });

  it('issues a refresh token prefixed with the session id and hashes it', () => {
    const { service } = createService();

    const refresh = service.issueRefreshToken('session-1');

    expect(refresh.token.startsWith('session-1.')).toBe(true);
    expect(refresh.hash).toBe(service.hashRefreshToken(refresh.token));
    expect(refresh.hash).not.toContain(refresh.token);
    expect(refresh.expiresAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('issues a different refresh token every time', () => {
    const { service } = createService();

    expect(service.issueRefreshToken('s').token).not.toBe(
      service.issueRefreshToken('s').token,
    );
  });

  it('parses the session id out of a refresh token', () => {
    const { service } = createService();

    expect(service.parseRefreshToken('abc.def')).toEqual({ sessionId: 'abc' });
  });

  it.each(['', 'nodot', '.secret', 'id.', 'a.'.repeat(120)])(
    'rejects a malformed refresh token (%#)',
    (token) => {
      const { service } = createService();

      expect(service.parseRefreshToken(token)).toBeNull();
    },
  );

  it('verifies its own access tokens and rejects tampered ones', async () => {
    const { service } = createService();
    const token = await service.signAccessToken('u1', 's1');

    await expect(service.verifyAccessToken(token)).resolves.toMatchObject({
      sub: 'u1',
      sid: 's1',
    });
    await expect(service.verifyAccessToken(`${token}x`)).rejects.toThrow();
  });
});
