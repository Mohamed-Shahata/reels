import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, Public } from '../../../src/auth/public.decorator';

class PublicController {
  @Public()
  open(): void {}

  closed(): void {}
}

describe('Public', () => {
  const reflector = new Reflector();
  const { open, closed } = Object.getOwnPropertyDescriptors(
    PublicController.prototype,
  );

  it('marks a handler as public', () => {
    expect(
      reflector.get<boolean>(IS_PUBLIC_KEY, open.value as () => void),
    ).toBe(true);
  });

  it('leaves other handlers unmarked', () => {
    expect(
      reflector.get<boolean | undefined>(
        IS_PUBLIC_KEY,
        closed.value as () => void,
      ),
    ).toBeUndefined();
  });
});
