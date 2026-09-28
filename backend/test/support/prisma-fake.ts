export interface StoredUser {
  id: string;
  email: string;
  passwordHash: string;
  createdAt: Date;
}

export interface StoredSession {
  id: string;
  userId: string;
  refreshTokenHash: string;
  expiresAt: Date;
}

export interface StoredVideo {
  id: string;
  userId: string;
  title: string;
  status: 'UPLOADING';
  createdAt: Date;
}

export function createPrismaFake() {
  const store: StoredUser[] = [];
  const sessions: StoredSession[] = [];
  const videos: StoredVideo[] = [];

  return {
    store,
    sessions,
    videos,
    $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    $connect: jest.fn(),
    $disconnect: jest.fn(),
    session: {
      create: jest.fn(({ data }: { data: StoredSession }) => {
        sessions.push(data);
        return Promise.resolve(data);
      }),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: {
            id: string;
            refreshTokenHash: string;
            expiresAt: { gt: Date };
          };
          data: { refreshTokenHash: string; expiresAt: Date };
        }) => {
          const match = sessions.find(
            (x) =>
              x.id === where.id &&
              x.refreshTokenHash === where.refreshTokenHash &&
              x.expiresAt > where.expiresAt.gt,
          );
          if (match) Object.assign(match, data);
          return Promise.resolve({ count: match ? 1 : 0 });
        },
      ),
      findUnique: jest.fn(({ where }: { where: { id: string } }) =>
        Promise.resolve(sessions.find((x) => x.id === where.id) ?? null),
      ),
      deleteMany: jest.fn(
        ({ where }: { where: { id: string; refreshTokenHash?: string } }) => {
          const before = sessions.length;
          const kept = sessions.filter(
            (x) =>
              !(
                x.id === where.id &&
                (where.refreshTokenHash === undefined ||
                  x.refreshTokenHash === where.refreshTokenHash)
              ),
          );
          sessions.splice(0, sessions.length, ...kept);
          return Promise.resolve({ count: before - sessions.length });
        },
      ),
      count: jest.fn(
        ({
          where,
        }: {
          where: { id: string; userId: string; expiresAt: { gt: Date } };
        }) =>
          Promise.resolve(
            sessions.filter(
              (x) =>
                x.id === where.id &&
                x.userId === where.userId &&
                x.expiresAt > where.expiresAt.gt,
            ).length,
          ),
      ),
    },
    user: {
      findUnique: jest.fn(
        ({
          where,
          select,
        }: {
          where: { email?: string; id?: string };
          select: Record<string, boolean>;
        }) => {
          const user = store.find((u) =>
            where.email !== undefined
              ? u.email === where.email
              : u.id === where.id,
          );
          if (!user) return Promise.resolve(null);
          return Promise.resolve(
            Object.fromEntries(
              Object.entries(user).filter(([key]) => select[key]),
            ),
          );
        },
      ),
      count: jest.fn(({ where }: { where: { email: string } }) =>
        Promise.resolve(store.filter((u) => u.email === where.email).length),
      ),
      create: jest.fn(
        ({ data }: { data: { email: string; passwordHash: string } }) => {
          const user: StoredUser = {
            id: `user-${store.length + 1}`,
            createdAt: new Date(),
            ...data,
          };
          store.push(user);
          return Promise.resolve({
            id: user.id,
            email: user.email,
            createdAt: user.createdAt,
          });
        },
      ),
    },
    video: {
      create: jest.fn(
        ({
          data,
          select,
        }: {
          data: { userId: string; title: string };
          select: Record<string, boolean>;
        }) => {
          const video: StoredVideo = {
            id: `video-${videos.length + 1}`,
            status: 'UPLOADING',
            createdAt: new Date(),
            ...data,
          };
          videos.push(video);
          return Promise.resolve(
            Object.fromEntries(
              Object.entries(video).filter(([key]) => select[key]),
            ),
          );
        },
      ),
      findFirst: jest.fn(
        ({
          where,
          select,
        }: {
          where: { id: string; userId: string; status: 'UPLOADING' };
          select: Record<string, boolean>;
        }) => {
          const video = videos.find(
            (item) =>
              item.id === where.id &&
              item.userId === where.userId &&
              item.status === where.status,
          );
          if (!video) return Promise.resolve(null);
          return Promise.resolve(
            Object.fromEntries(
              Object.entries(video).filter(([key]) => select[key]),
            ),
          );
        },
      ),
    },
  };
}
