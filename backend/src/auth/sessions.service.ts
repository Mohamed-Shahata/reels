import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

export interface CreateSessionInput {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
}

export interface RotateSessionInput {
  sessionId: string;
  currentHash: string;
  nextHash: string;
  nextExpiresAt: Date;
}

export type RotateResult =
  | { status: 'rotated'; userId: string }
  | { status: 'reused' }
  | { status: 'invalid' };

@Injectable()
export class SessionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(input: CreateSessionInput): Promise<void> {
    await this.prisma.session.create({ data: input });
  }

  // The compare-and-swap on the current hash makes rotation atomic, so only
  // one of two concurrent requests carrying the same token can succeed.
  async rotate(input: RotateSessionInput): Promise<RotateResult> {
    const now = new Date();

    const updated = await this.prisma.session.updateMany({
      where: {
        id: input.sessionId,
        refreshTokenHash: input.currentHash,
        expiresAt: { gt: now },
      },
      data: {
        refreshTokenHash: input.nextHash,
        expiresAt: input.nextExpiresAt,
      },
    });

    if (updated.count === 1) {
      const session = await this.prisma.session.findUnique({
        where: { id: input.sessionId },
        select: { userId: true },
      });
      return session
        ? { status: 'rotated', userId: session.userId }
        : { status: 'invalid' };
    }

    const existing = await this.prisma.session.findUnique({
      where: { id: input.sessionId },
      select: { expiresAt: true },
    });

    if (!existing) {
      return { status: 'invalid' };
    }

    await this.prisma.session.deleteMany({ where: { id: input.sessionId } });

    return existing.expiresAt > now
      ? { status: 'reused' }
      : { status: 'invalid' };
  }

  async revoke(sessionId: string, refreshTokenHash: string): Promise<void> {
    await this.prisma.session.deleteMany({
      where: { id: sessionId, refreshTokenHash },
    });
  }

  async isActive(sessionId: string, userId: string): Promise<boolean> {
    const count = await this.prisma.session.count({
      where: { id: sessionId, userId, expiresAt: { gt: new Date() } },
    });
    return count > 0;
  }
}
