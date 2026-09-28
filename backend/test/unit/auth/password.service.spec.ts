import { PasswordService } from '../../../src/auth/password.service';

describe('PasswordService', () => {
  const service = new PasswordService();

  it('hashes with argon2id and never returns the plain password', async () => {
    const hash = await service.hash('correct-horse-1');

    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(hash).not.toContain('correct-horse-1');
  });

  it('produces a different hash for the same password', async () => {
    const [a, b] = await Promise.all([
      service.hash('correct-horse-1'),
      service.hash('correct-horse-1'),
    ]);

    expect(a).not.toBe(b);
  });

  it('verifies the right password and rejects a wrong one', async () => {
    const hash = await service.hash('correct-horse-1');

    await expect(service.verify(hash, 'correct-horse-1')).resolves.toBe(true);
    await expect(service.verify(hash, 'wrong-horse-1')).resolves.toBe(false);
  });
});
