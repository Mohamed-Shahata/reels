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
  status: 'UPLOADING' | 'READY' | 'FAILED';
  createdAt: Date;
  updatedAt: Date;
  cloudinaryId?: string;
  durationSec?: number;
  sizeBytes?: bigint;
}

export interface StoredClip {
  id: string;
  videoId: string;
  title: string;
  startSec: number;
  endSec: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface StoredUsageRecord {
  id: string;
  userId: string;
  monthStart: Date;
  uploadedSeconds: number;
  clipCount: number;
  createdAt: Date;
  updatedAt: Date;
}

export function createPrismaFake() {
  const store: StoredUser[] = [];
  const sessions: StoredSession[] = [];
  const videos: StoredVideo[] = [];
  const clips: StoredClip[] = [];
  const usageRecords: StoredUsageRecord[] = [];

  return {
    store,
    sessions,
    videos,
    clips,
    usageRecords,
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
          const now = new Date();
          const video: StoredVideo = {
            id: `video-${videos.length + 1}`,
            status: 'UPLOADING',
            createdAt: now,
            updatedAt: now,
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
          where: {
            id: string;
            userId: string;
            status?:
              | 'UPLOADING'
              | 'READY'
              | 'FAILED'
              | { in: ('UPLOADING' | 'READY' | 'FAILED')[] };
          };
          select: Record<string, boolean>;
        }) => {
          const video = videos.find(
            (item) =>
              item.id === where.id &&
              item.userId === where.userId &&
              (where.status === undefined ||
                (typeof where.status === 'string' &&
                  item.status === where.status) ||
                (typeof where.status === 'object' &&
                  where.status.in.includes(item.status))),
          );
          if (!video) return Promise.resolve(null);
          return Promise.resolve(
            Object.fromEntries(
              Object.entries(video).filter(([key]) => select[key]),
            ),
          );
        },
      ),
      findMany: jest.fn(
        ({
          where,
          select,
        }: {
          where: {
            userId?: string;
            status?: 'UPLOADING' | 'READY' | 'FAILED';
            updatedAt?: { lt: Date };
          };
          orderBy?: { createdAt: 'desc' };
          select: Record<string, boolean>;
        }) =>
          Promise.resolve(
            videos
              .filter(
                (video) =>
                  (where.userId === undefined ||
                    video.userId === where.userId) &&
                  (where.status === undefined ||
                    video.status === where.status) &&
                  (where.updatedAt === undefined ||
                    video.updatedAt < where.updatedAt.lt),
              )
              .slice()
              .sort(
                (left, right) =>
                  right.createdAt.getTime() - left.createdAt.getTime(),
              )
              .map((video) =>
                Object.fromEntries(
                  Object.entries(video).filter(([key]) => select[key]),
                ),
              ),
          ),
      ),
      update: jest.fn(
        ({
          where,
          data,
          select,
        }: {
          where: { id: string };
          data: Partial<
            Pick<
              StoredVideo,
              'cloudinaryId' | 'durationSec' | 'sizeBytes' | 'status' | 'title'
            >
          >;
          select?: Record<string, boolean>;
        }) => {
          const video = videos.find((item) => item.id === where.id);
          if (!video) throw new Error('Video not found');
          Object.assign(video, data);
          video.updatedAt = new Date();
          return Promise.resolve(
            select
              ? Object.fromEntries(
                  Object.entries(video).filter(([key]) => select[key]),
                )
              : video,
          );
        },
      ),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: {
            id: string;
            userId?: string;
            status: 'UPLOADING' | 'READY' | 'FAILED';
            updatedAt?: { lt: Date };
          };
          data: { status: 'FAILED' };
        }) => {
          const video = videos.find(
            (item) =>
              item.id === where.id &&
              (where.userId === undefined || item.userId === where.userId) &&
              item.status === where.status &&
              (where.updatedAt === undefined ||
                item.updatedAt < where.updatedAt.lt),
          );
          if (video) {
            Object.assign(video, data, { updatedAt: new Date() });
          }
          return Promise.resolve({ count: video ? 1 : 0 });
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        const index = videos.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error('Video not found');
        const [video] = videos.splice(index, 1);
        const remainingClips = clips.filter(
          (clip) => clip.videoId !== video.id,
        );
        clips.splice(0, clips.length, ...remainingClips);
        return Promise.resolve(video);
      }),
    },
    clip: {
      create: jest.fn(
        ({
          data,
          select,
        }: {
          data: Pick<StoredClip, 'videoId' | 'title' | 'startSec' | 'endSec'>;
          select: Record<string, boolean>;
        }) => {
          const now = new Date();
          const clip: StoredClip = {
            id: `clip-${clips.length + 1}`,
            createdAt: now,
            updatedAt: now,
            ...data,
          };
          clips.push(clip);
          return Promise.resolve(
            Object.fromEntries(
              Object.entries(clip).filter(([key]) => select[key]),
            ),
          );
        },
      ),
      findMany: jest.fn(
        ({
          where,
          select,
        }: {
          where: { videoId: string };
          select: Record<string, boolean>;
        }) =>
          Promise.resolve(
            clips
              .filter((clip) => clip.videoId === where.videoId)
              .slice()
              .sort((left, right) => left.startSec - right.startSec)
              .map((clip) =>
                Object.fromEntries(
                  Object.entries(clip).filter(([key]) => select[key]),
                ),
              ),
          ),
      ),
      findFirst: jest.fn(
        ({
          where,
          select,
        }: {
          where: { id: string; video: { is: { userId: string } } };
          select: Record<string, boolean | { select: Record<string, boolean> }>;
        }) => {
          const clip = clips.find((item) => {
            const video = videos.find(
              (candidate) => candidate.id === item.videoId,
            );
            return (
              item.id === where.id && video?.userId === where.video.is.userId
            );
          });
          if (!clip) return Promise.resolve(null);

          const selected = Object.fromEntries(
            Object.entries(clip).filter(([key]) => select[key] === true),
          ) as Record<string, unknown>;
          const videoSelection = select.video;
          if (typeof videoSelection === 'object') {
            const video = videos.find((item) => item.id === clip.videoId)!;
            selected.video = Object.fromEntries(
              Object.entries(video).filter(
                ([key]) => videoSelection.select[key],
              ),
            );
          }
          return Promise.resolve(selected);
        },
      ),
      update: jest.fn(
        ({
          where,
          data,
          select,
        }: {
          where: { id: string };
          data: Partial<Pick<StoredClip, 'title' | 'startSec' | 'endSec'>>;
          select: Record<string, boolean>;
        }) => {
          const clip = clips.find((item) => item.id === where.id);
          if (!clip) throw new Error('Clip not found');
          Object.assign(clip, data, { updatedAt: new Date() });
          return Promise.resolve(
            Object.fromEntries(
              Object.entries(clip).filter(([key]) => select[key]),
            ),
          );
        },
      ),
      delete: jest.fn(({ where }: { where: { id: string } }) => {
        const index = clips.findIndex((item) => item.id === where.id);
        if (index === -1) throw new Error('Clip not found');
        const [clip] = clips.splice(index, 1);
        return Promise.resolve(clip);
      }),
    },
    usageRecord: {
      findUnique: jest.fn(
        ({
          where,
          select,
        }: {
          where: { userId_monthStart: { userId: string; monthStart: Date } };
          select: Record<string, boolean>;
        }) => {
          const record = usageRecords.find(
            (item) =>
              item.userId === where.userId_monthStart.userId &&
              item.monthStart.getTime() ===
                where.userId_monthStart.monthStart.getTime(),
          );
          if (!record) return Promise.resolve(null);
          return Promise.resolve(
            Object.fromEntries(
              Object.entries(record).filter(([key]) => select[key]),
            ),
          );
        },
      ),
      upsert: jest.fn(
        ({
          where,
          create,
          update,
        }: {
          where: { userId_monthStart: { userId: string; monthStart: Date } };
          create: Pick<
            StoredUsageRecord,
            'userId' | 'monthStart' | 'uploadedSeconds' | 'clipCount'
          >;
          update: {
            uploadedSeconds?: { increment: number };
            clipCount?: { increment: number };
          };
        }) => {
          const record = usageRecords.find(
            (item) =>
              item.userId === where.userId_monthStart.userId &&
              item.monthStart.getTime() ===
                where.userId_monthStart.monthStart.getTime(),
          );
          if (record) {
            record.uploadedSeconds += update.uploadedSeconds?.increment ?? 0;
            record.clipCount += update.clipCount?.increment ?? 0;
            record.updatedAt = new Date();
            return Promise.resolve(record);
          }
          const now = new Date();
          const created: StoredUsageRecord = {
            id: `usage-${usageRecords.length + 1}`,
            createdAt: now,
            updatedAt: now,
            ...create,
          };
          usageRecords.push(created);
          return Promise.resolve(created);
        },
      ),
    },
  };
}
