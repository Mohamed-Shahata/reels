import { ApiError, api } from '@/lib/api';

const user = {
  id: 'user-1',
  email: 'user@example.com',
  createdAt: '2026-09-28T10:00:00.000Z',
};

function response(body: unknown, status = 200, requestId?: string): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-request-id' ? (requestId ?? null) : null,
    },
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

  it('creates clips through the authenticated API', async () => {
    const clip = {
      id: 'clip-1',
      videoId: 'video-1',
      title: 'Key takeaway',
      startSec: 10,
      endSec: 30,
      source: 'MANUAL',
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:00:00.000Z',
    };
    fetchMock.mockResolvedValue(response(clip, 201));

    await expect(
      api.createClip('video-1', {
        title: 'Key takeaway',
        startSec: 10,
        endSec: 30,
      }),
    ).resolves.toEqual(clip);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/videos\/video-1\/clips$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: JSON.stringify({
          title: 'Key takeaway',
          startSec: 10,
          endSec: 30,
        }),
      }),
    );
  });

  it('requests the full AI suggestion set through the authenticated API', async () => {
    const clips = [
      {
        id: 'clip-1',
        videoId: 'video-1',
        title: 'Suggested topic',
        startSec: 0,
        endSec: 30,
        source: 'AI',
        createdAt: '2026-09-28T10:00:00.000Z',
        updatedAt: '2026-09-28T10:00:00.000Z',
      },
    ];
    fetchMock.mockResolvedValue(response(clips, 201));

    await expect(api.createAiClips('video-1')).resolves.toEqual(clips);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/videos\/video-1\/ai-clips$/),
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
        body: '{}',
      }),
    );
  });

  it('sends the replacement confirmation when re-running AI clips', async () => {
    fetchMock.mockResolvedValue(response([], 201));

    await api.createAiClips('video-1', { confirmReplace: true });

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/videos\/video-1\/ai-clips$/),
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ confirmReplace: true }),
      }),
    );
  });

  it('surfaces the monthly AI run limit as an API error', async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          statusCode: 429,
          message: 'Monthly AI run limit of 20 has been reached',
        },
        429,
        'req-9',
      ),
    );

    await expect(api.createAiClips('video-1')).rejects.toMatchObject({
      status: 429,
      message: 'Monthly AI run limit of 20 has been reached',
      requestId: 'req-9',
    });
  });

  it('loads the monthly usage including AI run counters', async () => {
    const usage = {
      month: '2026-09',
      uploadedMinutes: 28,
      clipCount: 4,
      aiRuns: 3,
      aiRunLimit: 20,
    };
    fetchMock.mockResolvedValue(response(usage));

    await expect(api.getUsage()).resolves.toEqual(usage);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/usage$/),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('updates, deletes and gets a download URL for a clip', async () => {
    const clip = {
      id: 'clip-1',
      videoId: 'video-1',
      title: 'Updated takeaway',
      startSec: 10,
      endSec: 35,
      source: 'MANUAL',
      createdAt: '2026-09-28T10:00:00.000Z',
      updatedAt: '2026-09-28T10:05:00.000Z',
    };
    fetchMock
      .mockResolvedValueOnce(response(clip))
      .mockResolvedValueOnce(response(null, 204))
      .mockResolvedValueOnce(response({ url: 'https://download.example' }));

    await expect(api.updateClip('clip-1', { endSec: 35 })).resolves.toEqual(
      clip,
    );
    await expect(api.deleteClip('clip-1')).resolves.toBeUndefined();
    await expect(api.getClipDownloadUrl('clip-1')).resolves.toEqual({
      url: 'https://download.example',
    });
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/clips\/clip-1$/),
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ endSec: 35 }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/clips\/clip-1$/),
      expect.objectContaining({ method: 'DELETE' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/\/clips\/clip-1\/download$/),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('requests reframed playback and download URLs only when asked', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ url: 'https://playback.example' }))
      .mockResolvedValueOnce(response({ url: 'https://reel.example' }))
      .mockResolvedValueOnce(response({ url: 'https://download.example' }));

    await api.getClipPlaybackUrl('clip-1');
    await api.getClipPlaybackUrl('clip-1', { reframe: true });
    await api.getClipDownloadUrl('clip-1', { reframe: true });

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/clips\/clip-1\/playback$/),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/clips\/clip-1\/playback\?reframe=true$/),
      expect.anything(),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/\/clips\/clip-1\/download\?reframe=true$/),
      expect.anything(),
    );
  });

  it('starts, lists and retries 9:16 renders', async () => {
    const render = {
      id: 'render-1',
      clipId: 'clip-1',
      status: 'PENDING',
      progress: 0,
      attempts: 0,
      error: null,
      startSec: 10,
      endSec: 35,
      outputUrl: null,
      subtitles: false,
      subtitleStyle: null,
      createdAt: '2026-09-29T10:00:00.000Z',
      updatedAt: '2026-09-29T10:00:00.000Z',
    };
    fetchMock
      .mockResolvedValueOnce(response(render, 202))
      .mockResolvedValueOnce(response([render], 202))
      .mockResolvedValueOnce(response([render]))
      .mockResolvedValueOnce(response(render, 202));

    await expect(api.renderClip('clip-1')).resolves.toEqual(render);
    await expect(api.renderAllClips('video-1')).resolves.toEqual([render]);
    await expect(api.getVideoRenders('video-1')).resolves.toEqual([render]);
    await expect(api.retryRender('render-1')).resolves.toEqual(render);

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      expect.stringMatching(/\/clips\/clip-1\/renders$/),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      expect.stringMatching(/\/videos\/video-1\/renders$/),
      expect.objectContaining({ method: 'POST' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      expect.stringMatching(/\/videos\/video-1\/renders$/),
      expect.objectContaining({ credentials: 'include' }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      expect.stringMatching(/\/renders\/render-1\/retry$/),
      expect.objectContaining({ method: 'POST' }),
    );
  });

  it('sends the subtitle toggle and style with a render request', async () => {
    const style = {
      fontFamily: 'Cairo',
      fontSizePx: 34,
      bold: true,
      textColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.63,
      position: 'BOTTOM',
      displayMode: 'PHRASE',
    } as const;
    const render = {
      id: 'render-2',
      clipId: 'clip-1',
      status: 'PENDING',
      progress: 0,
      attempts: 0,
      error: null,
      startSec: 10,
      endSec: 35,
      outputUrl: null,
      subtitles: true,
      subtitleStyle: style,
      createdAt: '2026-09-29T10:00:00.000Z',
      updatedAt: '2026-09-29T10:00:00.000Z',
    };
    fetchMock
      .mockResolvedValueOnce(response(render, 202))
      .mockResolvedValueOnce(response([render], 202))
      .mockResolvedValueOnce(
        response({ ...render, subtitles: false, subtitleStyle: null }, 202),
      );

    await expect(
      api.renderClip('clip-1', { subtitles: true, presetId: 'REEL', style }),
    ).resolves.toEqual(render);
    await api.renderAllClips('video-1', {
      subtitles: true,
      presetId: 'REEL',
      style,
    });
    await api.renderClip('clip-1', { subtitles: false, style });

    const bodyOf = (call: number) =>
      JSON.parse(
        (fetchMock.mock.calls[call][1] as { body: string }).body,
      ) as unknown;
    expect(bodyOf(0)).toEqual({ subtitles: true, preset: 'REEL', ...style });
    expect(bodyOf(1)).toEqual({ subtitles: true, preset: 'REEL', ...style });
    expect(bodyOf(2)).toEqual({});
  });

  it('sends an empty body when no render options are given', async () => {
    const render = {
      id: 'render-1',
      clipId: 'clip-1',
      status: 'PENDING',
      progress: 0,
      attempts: 0,
      error: null,
      startSec: 10,
      endSec: 35,
      outputUrl: null,
      subtitles: false,
      subtitleStyle: null,
      createdAt: '2026-09-29T10:00:00.000Z',
      updatedAt: '2026-09-29T10:00:00.000Z',
    };
    fetchMock.mockResolvedValue(response(render, 202));

    await api.renderClip('clip-1');

    expect((fetchMock.mock.calls[0][1] as { body: string }).body).toBe('{}');
  });

  it('rejects a render response that does not say whether subtitles are burned in', async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          id: 'render-1',
          clipId: 'clip-1',
          status: 'PENDING',
          progress: 0,
          attempts: 0,
          error: null,
          startSec: 10,
          endSec: 35,
          outputUrl: null,
          createdAt: '2026-09-29T10:00:00.000Z',
          updatedAt: '2026-09-29T10:00:00.000Z',
        },
        202,
      ),
    );

    await expect(api.renderClip('clip-1')).rejects.toThrow();
  });

  it('loads the download URL of a specific render', async () => {
    fetchMock.mockResolvedValue(
      response({ url: 'https://res.cloudinary.com/demo/subtitled.mp4' }),
    );

    await expect(api.getRenderDownloadUrl('render-1')).resolves.toEqual({
      url: 'https://res.cloudinary.com/demo/subtitled.mp4',
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/renders\/render-1\/download$/),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('accepts render jobs in the processing job list', async () => {
    const job = {
      id: 'job-1',
      type: 'RENDER',
      status: 'RUNNING',
      progress: 30,
      lastError: null,
      createdAt: '2026-09-29T10:00:00.000Z',
      startedAt: '2026-09-29T10:00:01.000Z',
      completedAt: null,
      failedAt: null,
    };
    fetchMock.mockResolvedValue(response([job]));

    await expect(api.getVideoProcessingJobs('video-1')).resolves.toEqual([job]);
  });

  it('loads the subtitle style catalog', async () => {
    const catalog = {
      defaultPresetId: 'REEL',
      fonts: ['Cairo', 'Amiri', 'Arial'],
      positions: ['TOP', 'MIDDLE', 'BOTTOM'],
      displayModes: ['PHRASE', 'WORD'],
      fontSize: { min: 20, max: 72 },
      presets: [
        {
          id: 'REEL',
          label: 'Reel',
          description: 'Bold white text on a dark box.',
          style: {
            fontFamily: 'Cairo',
            fontSizePx: 34,
            bold: true,
            textColor: '#ffffff',
            backgroundColor: '#000000',
            backgroundOpacity: 0.63,
            position: 'BOTTOM',
            displayMode: 'PHRASE',
          },
        },
      ],
    };
    fetchMock.mockResolvedValue(response(catalog));

    await expect(api.getSubtitleStyleCatalog()).resolves.toEqual(catalog);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/subtitles\/styles$/),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('rejects a subtitle style catalog with an unsupported font', async () => {
    fetchMock.mockResolvedValue(
      response({
        defaultPresetId: 'REEL',
        fonts: ['Tahoma'],
        positions: ['TOP'],
        fontSize: { min: 20, max: 72 },
        presets: [],
      }),
    );

    await expect(api.getSubtitleStyleCatalog()).rejects.toBeDefined();
  });

  it('surfaces the API error message to the form layer', async () => {
    fetchMock.mockResolvedValue(
      response({ message: 'Invalid email or password' }, 401),
    );

    await expect(api.login('user@example.com', 'wrong-pass-1')).rejects.toEqual(
      new ApiError('Invalid email or password', 401),
    );
  });

  it('keeps the request ID so the UI can reference the API log', async () => {
    fetchMock.mockResolvedValue(
      response({ message: 'Upload was not found' }, 404, 'req-upload-1'),
    );

    await expect(api.getVideos()).rejects.toMatchObject({
      message: 'Upload was not found',
      requestId: 'req-upload-1',
      status: 404,
    });
  });

  it('asks for word by word cues when a mode is given', async () => {
    fetchMock.mockResolvedValue(
      response({
        clipId: 'clip-1',
        language: 'ar',
        displayMode: 'WORD',
        startSec: 10,
        endSec: 30,
        durationSec: 20,
        timing: 'WORD',
        cues: [],
      }),
    );

    const result = await api.getClipSubtitles('clip-1', 'WORD');

    expect(result.displayMode).toBe('WORD');
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/clips\/clip-1\/subtitles\?mode=WORD$/),
      expect.anything(),
    );
  });

  it('sends the chosen AI clip mode', async () => {
    fetchMock.mockResolvedValue(response([]));

    await api.createAiClips('video-1', {
      confirmReplace: true,
      mode: 'HIGHLIGHTS',
    });

    const init = fetchMock.mock.calls[0][1] as { body: string };
    expect(JSON.parse(init.body)).toEqual({
      confirmReplace: true,
      mode: 'HIGHLIGHTS',
    });
  });

  it('fills in the phrase layout for styles stored before word mode existed', async () => {
    const legacy = {
      defaultPresetId: 'REEL',
      fonts: ['Cairo'],
      positions: ['TOP'],
      fontSize: { min: 20, max: 72 },
      presets: [
        {
          id: 'REEL',
          label: 'Reel',
          description: 'x',
          style: {
            fontFamily: 'Cairo',
            fontSizePx: 34,
            bold: true,
            textColor: '#ffffff',
            backgroundColor: '#000000',
            backgroundOpacity: 0.6,
            position: 'TOP',
          },
        },
      ],
    };
    fetchMock.mockResolvedValue(response(legacy));

    const catalog = await api.getSubtitleStyleCatalog();

    expect(catalog.presets[0].style.displayMode).toBe('PHRASE');
    expect(catalog.displayModes).toEqual(['PHRASE', 'WORD']);
  });

  it('loads the subtitle cues of a clip', async () => {
    const subtitles = {
      clipId: 'clip-1',
      language: 'ar',
      displayMode: 'PHRASE',
      startSec: 10,
      endSec: 30,
      durationSec: 20,
      timing: 'WORD',
      cues: [{ index: 1, startSec: 0.5, endSec: 2, text: 'Hello there' }],
    };
    fetchMock.mockResolvedValue(response(subtitles));

    await expect(api.getClipSubtitles('clip-1')).resolves.toEqual(subtitles);

    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/\/clips\/clip-1\/subtitles$/),
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('rejects subtitle cues with an unknown timing', async () => {
    fetchMock.mockResolvedValue(
      response({
        clipId: 'clip-1',
        language: 'ar',
        startSec: 10,
        endSec: 30,
        durationSec: 20,
        timing: 'GUESSED',
        cues: [],
      }),
    );

    await expect(api.getClipSubtitles('clip-1')).rejects.toThrow();
  });

  describe('subtitle edits in render requests', () => {
    const style = {
      fontFamily: 'Cairo',
      fontSizePx: 34,
      bold: true,
      textColor: '#ffffff',
      backgroundColor: '#000000',
      backgroundOpacity: 0.63,
      position: 'BOTTOM',
      displayMode: 'PHRASE',
    } as const;
    const edits = [{ index: 2, text: 'Fixed line' }];
    const render = {
      id: 'render-3',
      clipId: 'clip-1',
      status: 'PENDING',
      progress: 0,
      attempts: 0,
      error: null,
      startSec: 10,
      endSec: 35,
      outputUrl: null,
      subtitles: true,
      subtitleStyle: style,
      subtitleEdits: edits,
      createdAt: '2026-09-29T10:00:00.000Z',
      updatedAt: '2026-09-29T10:00:00.000Z',
    };

    const bodyOf = (call: number) =>
      JSON.parse(
        (fetchMock.mock.calls[call][1] as { body: string }).body,
      ) as unknown;

    it('sends the edits with a single clip render and reads them back', async () => {
      fetchMock.mockResolvedValue(response(render, 202));

      await expect(
        api.renderClip('clip-1', {
          subtitles: true,
          presetId: 'REEL',
          style,
          edits,
        }),
      ).resolves.toEqual(render);

      expect(bodyOf(0)).toEqual({
        subtitles: true,
        preset: 'REEL',
        ...style,
        subtitleEdits: edits,
      });
    });

    it('sends no edit field when there are no edits', async () => {
      fetchMock.mockResolvedValue(response(render, 202));

      await api.renderClip('clip-1', { subtitles: true, style, edits: [] });

      expect(bodyOf(0)).not.toHaveProperty('subtitleEdits');
    });

    it('never sends edits with the whole video render', async () => {
      fetchMock.mockResolvedValue(response([render], 202));

      await api.renderAllClips('video-1', { subtitles: true, style, edits });

      expect(bodyOf(0)).not.toHaveProperty('subtitleEdits');
    });

    it('sends nothing but an empty body when subtitles are off', async () => {
      fetchMock.mockResolvedValue(response(render, 202));

      await api.renderClip('clip-1', { subtitles: false, edits });

      expect(bodyOf(0)).toEqual({});
    });
  });
});
