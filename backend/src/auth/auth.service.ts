import {
  ConflictException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client';
import { type PublicUser, UsersService } from '../users/users.service';
import type { LoginDto } from './dto/login.dto';
import type { RegisterDto } from './dto/register.dto';
import { PasswordService } from './password.service';
import { SessionsService } from './sessions.service';
import { TokenService } from './token.service';
import type { SessionTokens } from './auth-cookies.service';

const EMAIL_TAKEN_MESSAGE = 'Email is already registered';
const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';
const INVALID_SESSION_MESSAGE = 'Invalid or expired session';

export interface LoginResult {
  user: PublicUser;
  tokens: SessionTokens;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash?: Promise<string>;

  constructor(
    private readonly users: UsersService,
    private readonly passwords: PasswordService,
    private readonly sessions: SessionsService,
    private readonly tokens: TokenService,
  ) {}

  async register(dto: RegisterDto): Promise<PublicUser> {
    if (await this.users.existsByEmail(dto.email)) {
      throw new ConflictException(EMAIL_TAKEN_MESSAGE);
    }

    const passwordHash = await this.passwords.hash(dto.password);

    try {
      return await this.users.create({ email: dto.email, passwordHash });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(EMAIL_TAKEN_MESSAGE);
      }
      throw error;
    }
  }

  async login(dto: LoginDto): Promise<LoginResult> {
    const credentials = await this.users.findCredentialsByEmail(dto.email);
    const hash = credentials?.passwordHash ?? (await this.getDummyHash());
    const passwordMatches = await this.passwords.verify(hash, dto.password);

    if (!credentials || !passwordMatches) {
      throw new UnauthorizedException(INVALID_CREDENTIALS_MESSAGE);
    }

    const sessionId = this.tokens.newSessionId();
    const refresh = this.tokens.issueRefreshToken(sessionId);

    await this.sessions.create({
      id: sessionId,
      userId: credentials.id,
      refreshTokenHash: refresh.hash,
      expiresAt: refresh.expiresAt,
    });

    const accessToken = await this.tokens.signAccessToken(
      credentials.id,
      sessionId,
    );

    return {
      user: {
        id: credentials.id,
        email: credentials.email,
        createdAt: credentials.createdAt,
      },
      tokens: { accessToken, refreshToken: refresh.token },
    };
  }

  async refresh(refreshToken: string | undefined): Promise<SessionTokens> {
    const parsed = refreshToken
      ? this.tokens.parseRefreshToken(refreshToken)
      : null;

    if (!refreshToken || !parsed) {
      throw new UnauthorizedException(INVALID_SESSION_MESSAGE);
    }

    const next = this.tokens.issueRefreshToken(parsed.sessionId);
    const result = await this.sessions.rotate({
      sessionId: parsed.sessionId,
      currentHash: this.tokens.hashRefreshToken(refreshToken),
      nextHash: next.hash,
      nextExpiresAt: next.expiresAt,
    });

    if (result.status === 'reused') {
      this.logger.warn(
        `Refresh token reuse detected, session ${parsed.sessionId} revoked`,
      );
    }

    if (result.status !== 'rotated') {
      throw new UnauthorizedException(INVALID_SESSION_MESSAGE);
    }

    const accessToken = await this.tokens.signAccessToken(
      result.userId,
      parsed.sessionId,
    );

    return { accessToken, refreshToken: next.token };
  }

  async logout(refreshToken: string | undefined): Promise<void> {
    const parsed = refreshToken
      ? this.tokens.parseRefreshToken(refreshToken)
      : null;

    if (!refreshToken || !parsed) {
      return;
    }

    await this.sessions.revoke(
      parsed.sessionId,
      this.tokens.hashRefreshToken(refreshToken),
    );
  }

  async getCurrentUser(userId: string): Promise<PublicUser> {
    const user = await this.users.findPublicById(userId);

    if (!user) {
      throw new UnauthorizedException(INVALID_SESSION_MESSAGE);
    }

    return user;
  }

  // Verifying against a dummy hash keeps response time similar for unknown emails.
  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.passwords.hash('dummy-password-for-timing');
    return this.dummyHash;
  }
}
