import { Logger } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';

export async function withAdvisoryLock<T>(
  prisma: PrismaService,
  lockId: number,
  fn: () => Promise<T>,
): Promise<T | null> {
  const logger = new Logger('AdvisoryLock');

  try {
    return await prisma.$transaction(async (tx) => {
      const result = await tx.$queryRaw<
        Array<{ pg_try_advisory_xact_lock: boolean }>
      >`
        SELECT pg_try_advisory_xact_lock(${lockId}) as pg_try_advisory_xact_lock;
      `;

      const acquired = result?.[0]?.pg_try_advisory_xact_lock ?? false;
      if (!acquired) {
        logger.debug(
          `Could not acquire advisory lock ${lockId}, skipping execution`,
        );
        return null;
      }

      logger.debug(`Acquired advisory lock ${lockId}`);
      return await fn();
    });
  } catch (err) {
    logger.error(
      `Error running with advisory lock ${lockId}: ${(err as Error).message}`,
    );
    return null;
  }
}
