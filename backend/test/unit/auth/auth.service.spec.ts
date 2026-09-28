import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '../../../src/generated/prisma/client';
import type { UsersService } from '../../../src/users/users.service';
import { AuthService } from '../../../src/auth/auth.service';
import type { SessionsService } from '../../../src/auth/sessions.service';
import type { TokenService } from '../../../src/auth/token.service';

const createdUser = {
  id: 'user-1',
  email: 'user@example.com',
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
};

function setup() {
  const users = {
    existsByEmail: jest.fn<Promise<boolean>, [string]>(),
    create: jest.fn(),
    findCredentialsByEmail: jest.fn(),
    findPublicById: jest.fn(),
  };
  const passwords = {
    hash: jest.fn<Promise<string>, [string]>().mockResolvedValue('hashed'),
    verify: jest.fn<Promise<boolean>, [string, string]>(),
  };
  const sessions = {
    create: jest.fn().mockResolvedValue(undefined),
    rotate: jest.fn(),
    revoke: jest.fn().mockResolvedValue(undefined),
  };
  const tokens = {
    newSessionId: jest.fn().mockReturnValue('session-1'),
    issueRefreshToken: jest.fn().mockReturnValue({
      token: 'session-1.secret',
      hash: 'refresh-hash',
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
    }),
    signAccessToken: jest.fn().mockResolvedValue('access-jwt'),
    parseRefreshToken: jest.fn((token: string) =>
      token.includes('.') ? { sessionId: token.split('.')[0] } : null,
    ),
    hashRefreshToken: jest.fn((token: string) => `hash-of-${token}`),
  };
  const service = new AuthService(
    users as unknown as UsersService,
    passwords,
    sessions as unknown as SessionsService,
    tokens as unknown as TokenService,
  );

  return { service, users, passwords, sessions, tokens };
}

describe('AuthService.register', () => {
  it('stores the hash, never the plain password, and returns the public user', async () => {
    const { service, users, passwords } = setup();
    users.existsByEmail.mockResolvedValue(false);
    users.create.mockResolvedValue(createdUser);

    const result = await service.register({
      email: 'user@example.com',
      password: 'secret-pass-1',
    });

    expect(passwords.hash).toHaveBeenCalledWith('secret-pass-1');
    expect(users.create).toHaveBeenCalledWith({
      email: 'user@example.com',
      passwordHash: 'hashed',
    });
    expect(result).toEqual(createdUser);
    expect(result).not.toHaveProperty('passwordHash');
  });

  it('rejects a duplicate email without hashing or creating', async () => {
    const { service, users, passwords } = setup();
    users.existsByEmail.mockResolvedValue(true);

    await expect(
      service.register({
        email: 'user@example.com',
        password: 'secret-pass-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(passwords.hash).not.toHaveBeenCalled();
    expect(users.create).not.toHaveBeenCalled();
  });

  it('maps a unique constraint race to a conflict', async () => {
    const { service, users } = setup();
    users.existsByEmail.mockResolvedValue(false);
    users.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('unique', {
        code: 'P2002',
        clientVersion: 'test',
      }),
    );

    await expect(
      service.register({
        email: 'user@example.com',
        password: 'secret-pass-1',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rethrows unexpected errors', async () => {
    const { service, users } = setup();
    users.existsByEmail.mockResolvedValue(false);
    users.create.mockRejectedValue(new Error('db down'));

    await expect(
      service.register({
        email: 'user@example.com',
        password: 'secret-pass-1',
      }),
    ).rejects.toThrow('db down');
  });
});

describe('AuthService.login', () => {
  const credentials = { ...createdUser, passwordHash: 'stored-hash' };

  it('creates a hashed session and returns tokens for valid credentials', async () => {
    const { service, users, passwords, sessions, tokens } = setup();
    users.findCredentialsByEmail.mockResolvedValue(credentials);
    passwords.verify.mockResolvedValue(true);

    const result = await service.login({
      email: 'user@example.com',
      password: 'secret-pass-1',
    });

    expect(passwords.verify).toHaveBeenCalledWith(
      'stored-hash',
      'secret-pass-1',
    );
    expect(sessions.create).toHaveBeenCalledWith({
      id: 'session-1',
      userId: 'user-1',
      refreshTokenHash: 'refresh-hash',
      expiresAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(tokens.signAccessToken).toHaveBeenCalledWith('user-1', 'session-1');
    expect(result.tokens).toEqual({
      accessToken: 'access-jwt',
      refreshToken: 'session-1.secret',
    });
    expect(result.user).toEqual(createdUser);
    expect(result.user).not.toHaveProperty('passwordHash');
  });

  it('returns the same generic error for a wrong password', async () => {
    const { service, users, passwords, sessions } = setup();
    users.findCredentialsByEmail.mockResolvedValue(credentials);
    passwords.verify.mockResolvedValue(false);

    await expect(
      service.login({ email: 'user@example.com', password: 'wrong-pass-1' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    expect(sessions.create).not.toHaveBeenCalled();
  });

  it('returns the same generic error for an unknown email and still verifies a hash', async () => {
    const { service, users, passwords, sessions } = setup();
    users.findCredentialsByEmail.mockResolvedValue(null);
    passwords.verify.mockResolvedValue(true);

    await expect(
      service.login({ email: 'nobody@example.com', password: 'secret-pass-1' }),
    ).rejects.toThrow(new UnauthorizedException('Invalid email or password'));
    expect(passwords.verify).toHaveBeenCalledTimes(1);
    expect(sessions.create).not.toHaveBeenCalled();
  });
});

describe('AuthService.refresh', () => {
  it('rotates the refresh token and returns fresh tokens', async () => {
    const { service, sessions, tokens } = setup();
    sessions.rotate.mockResolvedValue({ status: 'rotated', userId: 'user-1' });

    const result = await service.refresh('session-1.old-secret');

    expect(sessions.rotate).toHaveBeenCalledWith({
      sessionId: 'session-1',
      currentHash: 'hash-of-session-1.old-secret',
      nextHash: 'refresh-hash',
      nextExpiresAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    expect(tokens.signAccessToken).toHaveBeenCalledWith('user-1', 'session-1');
    expect(result).toEqual({
      accessToken: 'access-jwt',
      refreshToken: 'session-1.secret',
    });
  });

  it.each([undefined, 'malformed'])(
    'rejects a missing or malformed token (%s) without touching sessions',
    async (token) => {
      const { service, sessions } = setup();

      await expect(service.refresh(token)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(sessions.rotate).not.toHaveBeenCalled();
    },
  );

  it.each(['reused', 'invalid'] as const)(
    'rejects with 401 when rotation reports %s and issues no access token',
    async (status) => {
      const { service, sessions, tokens } = setup();
      sessions.rotate.mockResolvedValue({ status });

      await expect(service.refresh('session-1.old')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
      expect(tokens.signAccessToken).not.toHaveBeenCalled();
    },
  );
});

describe('AuthService.logout', () => {
  it('revokes the session matching the refresh token', async () => {
    const { service, sessions } = setup();

    await service.logout('session-1.secret');

    expect(sessions.revoke).toHaveBeenCalledWith(
      'session-1',
      'hash-of-session-1.secret',
    );
  });

  it.each([undefined, 'malformed'])(
    'is a no-op for a missing or malformed token (%s)',
    async (token) => {
      const { service, sessions } = setup();

      await expect(service.logout(token)).resolves.toBeUndefined();
      expect(sessions.revoke).not.toHaveBeenCalled();
    },
  );
});

describe('AuthService.getCurrentUser', () => {
  it('returns the public user', async () => {
    const { service, users } = setup();
    users.findPublicById.mockResolvedValue(createdUser);

    await expect(service.getCurrentUser('user-1')).resolves.toEqual(
      createdUser,
    );
  });

  it('rejects when the user no longer exists', async () => {
    const { service, users } = setup();
    users.findPublicById.mockResolvedValue(null);

    await expect(service.getCurrentUser('gone')).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
