import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, ThrottlerGuard } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import type { PublicUser } from '../users/users.service';
import { AuthCookiesService } from './auth-cookies.service';
import { AuthService } from './auth.service';
import { CurrentUser } from './current-user.decorator';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import type { AuthContext } from './jwt-auth.guard';
import { Public } from './public.decorator';

@Controller('auth')
@UseGuards(ThrottlerGuard)
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookies: AuthCookiesService,
  ) {}

  @Public()
  @Post('register')
  @HttpCode(HttpStatus.CREATED)
  register(@Body() dto: RegisterDto): Promise<PublicUser> {
    return this.auth.register(dto);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<PublicUser> {
    const { user, tokens } = await this.auth.login(dto);
    this.cookies.setSession(response, tokens);
    return user;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.NO_CONTENT)
  async refresh(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    try {
      const tokens = await this.auth.refresh(
        this.cookies.readRefreshToken(request),
      );
      this.cookies.setSession(response, tokens);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        this.cookies.clearSession(response);
      }
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ): Promise<void> {
    await this.auth.logout(this.cookies.readRefreshToken(request));
    this.cookies.clearSession(response);
  }

  @Get('me')
  @SkipThrottle()
  me(@CurrentUser() auth: AuthContext): Promise<PublicUser> {
    return this.auth.getCurrentUser(auth.userId);
  }
}
