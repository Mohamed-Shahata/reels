import { createValidationPipe } from '../../../src/common/pipes/validation.pipe';
import { CreateClipRenderDto } from '../../../src/renders/dto/create-clip-render.dto';
import { CreateRenderDto } from '../../../src/renders/dto/create-render.dto';

function validateClip(body: unknown) {
  return createValidationPipe().transform(body, {
    type: 'body',
    metatype: CreateClipRenderDto,
  }) as Promise<CreateClipRenderDto>;
}

function validateBulk(body: unknown) {
  return createValidationPipe().transform(body, {
    type: 'body',
    metatype: CreateRenderDto,
  }) as Promise<CreateRenderDto>;
}

describe('CreateClipRenderDto', () => {
  it('accepts subtitle edits next to the subtitle toggle', async () => {
    const result = await validateClip({
      subtitles: true,
      subtitleEdits: [{ index: 2, text: 'Fixed line' }],
    });

    expect(result.subtitleEdits).toEqual([{ index: 2, text: 'Fixed line' }]);
  });

  it('still accepts a body without edits', async () => {
    await expect(validateClip({ subtitles: true })).resolves.toMatchObject({
      subtitles: true,
    });
  });

  it('accepts an empty text so a cue can be hidden', async () => {
    await expect(
      validateClip({
        subtitles: true,
        subtitleEdits: [{ index: 1, text: '' }],
      }),
    ).resolves.toBeDefined();
  });

  it.each([
    ['edits that are not a list', { subtitleEdits: 'text' }],
    ['a zero cue index', { subtitleEdits: [{ index: 0, text: 'A' }] }],
    ['a fractional cue index', { subtitleEdits: [{ index: 1.5, text: 'A' }] }],
    ['a missing text', { subtitleEdits: [{ index: 1 }] }],
    ['a non string text', { subtitleEdits: [{ index: 1, text: 5 }] }],
    [
      'a text above the limit',
      { subtitleEdits: [{ index: 1, text: 'a'.repeat(201) }] },
    ],
    [
      'an unknown edit field',
      { subtitleEdits: [{ index: 1, text: 'A', startSec: 3 }] },
    ],
    [
      'too many edits',
      {
        subtitleEdits: Array.from({ length: 501 }, (_, index) => ({
          index: index + 1,
          text: 'A',
        })),
      },
    ],
  ])('rejects %s', async (_name, body) => {
    await expect(
      validateClip({ subtitles: true, ...body }),
    ).rejects.toMatchObject({ status: 400 });
  });

  it('is not accepted by the whole video route', async () => {
    await expect(
      validateBulk({
        subtitles: true,
        subtitleEdits: [{ index: 1, text: 'A' }],
      }),
    ).rejects.toMatchObject({ status: 400 });
  });
});
