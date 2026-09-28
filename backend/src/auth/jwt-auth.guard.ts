import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthCookiesService } from './auth-cookies.service';
import { IS_PUBLIC_KEY } from './public.decorator';
import { SessionsService } from './sessions.service';
import { TokenService } from './token.service';

export interface AuthContext {
  userId: string;
  sessionId: string;
}

export type AuthenticatedRequest = Request & { auth: AuthContext };

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly cookies: AuthCookiesService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(
      IS_PUBLIC_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = this.cookies.readAccessToken(request);

    if (!token) {
      throw new UnauthorizedException('Authentication required');
    }

    const payload = await this.tokens.verifyAccessToken(token).catch(() => {
      throw new UnauthorizedException('Authentication required');
    });

    if (
      typeof payload.sub !== 'string' ||
      typeof payload.sid !== 'string' ||
      !(await this.sessions.isActive(payload.sid, payload.sub))
    ) {
      throw new UnauthorizedException('Authentication required');
    }

    request.auth = { userId: payload.sub, sessionId: payload.sid };
    return true;
  }
}
