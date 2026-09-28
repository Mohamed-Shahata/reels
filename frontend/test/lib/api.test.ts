import { ApiError, api } from '@/lib/api';

const user = {
  id: 'user-1',
  email: 'user@example.com',
  createdAt: '2026-09-28T10:00:00.000Z',
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe('api', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock;
  });

  it('sends login credentials with browser cookies enabled', async () => {
    fetchMock.mockResolvedValue(response(user));

    await expect(
      api.login('user@example.com', 'secret-pass-1'),
    ).resolves.toEqual(user);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/login$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          email: 'user@example.com',
          password: 'secret-pass-1',
        }),
      }),
    );
  });

  it('handles a no-content refresh response', async () => {
    fetchMock.mockResolvedValue(response(null, 204));

    await expect(api.refresh()).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/auth\/refresh$/),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('creates a video record before starting a direct upload', async () => {
    fetchMock.mockResolvedValue(
      response({
        video: { ...user, title: 'Episode 42', status: 'UPLOADING' },
        upload: {
          uploadUrl: 'https://api.cloudinary.com/v1_1/demo/video/upload',
          cloudName: 'demo',
          apiKey: 'key',
          timestamp: 1,
          signature: 'signature',
          publicId: 'podcast-reels/uploads/user-1/video-1',
          resourceType: 'video',
          allowedFormats: ['mp4', 'mov', 'webm'],
          maxFileSizeBytes: 1000,
          maxDurationSec: 60,
        },
      }),
    );

    await expect(api.createVideo('Episode 42')).resolves.toMatchObject({
      video: { id: 'user-1', title: 'Episode 42', status: 'UPLOADING' },
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/videos$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({ title: 'Episode 42' }),
      }),
    );
  });

  it('requests a fresh signature when resuming a pending upload', async () => {
    fetchMock.mockResolvedValue(
      response({
        uploadUrl: 'https://api.cloudinary.com/v1_1/demo/video/upload',
        cloudName: 'demo',
        apiKey: 'key',
        timestamp: 2,
        signature: 'fresh-signature',
        publicId: 'podcast-reels/uploads/user-1/video-1',
        resourceType: 'video',
        allowedFormats: ['mp4', 'mov', 'webm'],
        maxFileSizeBytes: 1000,
        maxDurationSec: 60,
      }),
    );

    await expect(api.getVideoUploadSignature('video-1')).resolves.toMatchObject(
      {
        publicId: 'podcast-reels/uploads/user-1/video-1',
        signature: 'fresh-signature',
      },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/videos\/video-1\/upload-signature$/),
      expect.objectContaining({ method: 'POST', credentials: 'include' }),
    );
  });

  it('gets upload constraints before creating a video record', async () => {
    fetchMock.mockResolvedValue(
      response({
        allowedFormats: ['mp4'],
        maxFileSizeBytes: 1000,
        maxDurationSec: 60,
      }),
    );

    await expect(api.getVideoUploadConstraints()).resolves.toEqual({
      allowedFormats: ['mp4'],
      maxFileSizeBytes: 1000,
      maxDurationSec: 60,
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/videos\/upload-constraints$/),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('lists, renames and deletes library videos', async () => {
    const video = {
      id: 'video-1',
      title: 'Episode 42',
      cloudinaryId: 'videos/user-1/video-1',
      durationSec: 64.5,
      sizeBytes: '123456',
      status: 'READY',
      createdAt: '2026-09-28T10:00:00.000Z',
    };
    fetchMock
      .mockResolvedValueOnce(response([video]))
      .mockResolvedValueOnce(response({ ...video, title: 'Renamed episode' }))
      .mockResolvedValueOnce(response(null, 204));

    await expect(api.getVideos()).resolves.toEqual([video]);
    await expect(
      api.renameVideo('video-1', 'Renamed episode'),
    ).resolves.toMatchObject({
      title: 'Renamed episode',
    });
    await expect(api.deleteVideo('video-1')).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/videos\/video-1$/),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ title: 'Renamed episode' }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/\/videos\/video-1$/),
      expect.objectContaining({ method: 'DELETE' }),
    );
  });

  it('confirms the uploaded video before treating it as ready', async () => {
    fetchMock.mockResolvedValue(
      response({
        id: 'video-1',
        title: 'Episode 42',
        cloudinaryId: 'videos/user-1/video-1',
        durationSec: 64.5,
        sizeBytes: '123456',
        status: 'READY',
      }),
    );

    await expect(
      api.completeVideo('video-1', 'podcast-reels/uploads/user-1/video-1'),
    ).resolves.toMatchObject({
      status: 'READY',
      sizeBytes: '123456',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/videos\/video-1\/complete$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          publicId: 'podcast-reels/uploads/user-1/video-1',
        }),
      }),
    );
  });

  it('surfaces the API error message to the form layer', async () => {
    fetchMock.mockResolvedValue(
      response({ message: 'Invalid email or password' }, 401),
    );

    await expect(api.login('user@example.com', 'wrong-pass-1')).rejects.toEqual(
      new ApiError('Invalid email or password', 401),
    );
  });
});
