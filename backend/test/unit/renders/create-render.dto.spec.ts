import { createValidationPipe } from '../../../src/common/pipes/validation.pipe';
import { CreateRenderDto } from '../../../src/renders/dto/create-render.dto';

async function validate(body: unknown) {
  return createValidationPipe().transform(body, {
    type: 'body',
    metatype: CreateRenderDto,
  }) as Promise<CreateRenderDto>;
}

describe('CreateRenderDto', () => {
  it('accepts an empty body so existing clients keep rendering without subtitles', async () => {
    await expect(validate({})).resolves.toEqual({});
  });

  it('accepts the toggle with a preset and style overrides', async () => {
    await expect(
      validate({
        subtitles: true,
        preset: 'HIGHLIGHT',
        fontFamily: 'Amiri',
        fontSizePx: 48,
        bold: false,
        textColor: '#FACC15',
        backgroundColor: '#000000',
        backgroundOpacity: 0.5,
        position: 'TOP',
      }),
    ).resolves.toMatchObject({ subtitles: true, preset: 'HIGHLIGHT' });
  });

  it.each([
    ['a non boolean toggle', { subtitles: 'yes' }],
    ['an unknown preset', { subtitles: true, preset: 'NEON' }],
    ['an unknown font', { subtitles: true, fontFamily: 'Tahoma' }],
    ['a size below the minimum', { subtitles: true, fontSizePx: 10 }],
    ['a fractional size', { subtitles: true, fontSizePx: 30.5 }],
    ['a color that is not hex', { subtitles: true, textColor: 'white' }],
    ['an opacity above one', { subtitles: true, backgroundOpacity: 2 }],
    ['an unknown position', { subtitles: true, position: 'LEFT' }],
    ['an unknown field', { subtitles: true, extra: 1 }],
  ])('rejects %s', async (_label, body) => {
    await expect(validate(body)).rejects.toMatchObject({ status: 400 });
  });
});
