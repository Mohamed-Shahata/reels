import {
  describeError,
  toError,
} from '../../../../src/common/errors/describe-error';

describe('describeError', () => {
  it('reads Error messages', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
  });

  it('reads the nested Cloudinary error shape', () => {
    expect(
      describeError({ error: { message: 'Invalid font', http_code: 400 } }),
    ).toBe('Invalid font (HTTP 400)');
  });

  it('reads a flat message with a status code', () => {
    expect(describeError({ message: 'Rate limit', http_code: 420 })).toBe(
      'Rate limit (HTTP 420)',
    );
  });

  it('falls back for values without a message', () => {
    expect(describeError(undefined)).toBe('unknown error');
    expect(describeError(null, 'nope')).toBe('nope');
  });

  it('serialises unknown objects instead of hiding them', () => {
    expect(describeError({ foo: 1 })).toBe('{"foo":1}');
  });
});

describe('toError', () => {
  it('wraps plain objects in a real Error with context', () => {
    const wrapped = toError({ message: 'bad', http_code: 400 }, 'Render');
    expect(wrapped).toBeInstanceOf(Error);
    expect(wrapped.message).toBe('Render: bad (HTTP 400)');
  });
});
