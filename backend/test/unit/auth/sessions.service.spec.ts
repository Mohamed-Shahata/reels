import type { PrismaService } from '../../../src/prisma/prisma.service';
import { SessionsService } from '../../../src/auth/sessions.service';

const input = {
  sessionId: 's1',
  currentHash: 'old',
  nextHash: 'new',
  nextExpiresAt: new Date('2030-01-01T00:00:00.000Z'),
};

function setup() {
  const session = {
    create: jest.fn(),
    updateMany: jest.fn(),
    findUnique: jest.fn(),
    deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    count: jest.fn(),
  };
  const service = new SessionsService({ session } as unknown as PrismaService);

  return { service, session };
}

describe('SessionsService.rotate', () => {
  it('swaps the hash only when the current hash matches', async () => {
    const { service, session } = setup();
    session.updateMany.mockResolvedValue({ count: 1 });
    session.findUnique.mockResolvedValue({ userId: 'u1' });

    await expect(service.rotate(input)).resolves.toEqual({
      status: 'rotated',
      userId: 'u1',
    });
    expect(session.updateMany).toHaveBeenCalledWith({
      where: {
        id: 's1',
        refreshTokenHash: 'old',
        expiresAt: { gt: expect.any(Date) as Date },
      },
      data: { refreshTokenHash: 'new', expiresAt: input.nextExpiresAt },
    });
    expect(session.deleteMany).not.toHaveBeenCalled();
  });

  it('treats a mismatching hash on a live session as reuse and revokes it', async () => {
    const { service, session } = setup();
    session.updateMany.mockResolvedValue({ count: 0 });
    session.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() + 60_000),
    });

    await expect(service.rotate(input)).resolves.toEqual({ status: 'reused' });
    expect(session.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } });
  });

  it('reports an unknown session as invalid', async () => {
    const { service, session } = setup();
    session.updateMany.mockResolvedValue({ count: 0 });
    session.findUnique.mockResolvedValue(null);

    await expect(service.rotate(input)).resolves.toEqual({ status: 'invalid' });
    expect(session.deleteMany).not.toHaveBeenCalled();
  });

  it('reports an expired session as invalid and removes it', async () => {
    const { service, session } = setup();
    session.updateMany.mockResolvedValue({ count: 0 });
    session.findUnique.mockResolvedValue({
      expiresAt: new Date(Date.now() - 60_000),
    });

    await expect(service.rotate(input)).resolves.toEqual({ status: 'invalid' });
    expect(session.deleteMany).toHaveBeenCalledWith({ where: { id: 's1' } });
  });
});

describe('SessionsService.revoke', () => {
  it('only deletes the session when the hash matches', async () => {
    const { service, session } = setup();

    await service.revoke('s1', 'h');

    expect(session.deleteMany).toHaveBeenCalledWith({
      where: { id: 's1', refreshTokenHash: 'h' },
    });
  });
});

describe('SessionsService.isActive', () => {
  it('is true when a live session exists for the user', async () => {
    const { service, session } = setup();
    session.count.mockResolvedValue(1);

    await expect(service.isActive('s1', 'u1')).resolves.toBe(true);
  });

  it('is false when none exists', async () => {
    const { service, session } = setup();
    session.count.mockResolvedValue(0);

    await expect(service.isActive('s1', 'u1')).resolves.toBe(false);
  });
});
