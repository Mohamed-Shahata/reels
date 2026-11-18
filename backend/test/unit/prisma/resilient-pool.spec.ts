import { isTransientConnectionError } from '../../../src/prisma/resilient-pool';

describe('isTransientConnectionError', () => {
  it('detects the TLS disconnect seen with serverless Postgres', () => {
    expect(
      isTransientConnectionError(
        new Error(
          'Client network socket disconnected before secure TLS connection was established',
        ),
      ),
    ).toBe(true);
  });

  it('detects connection resets and timeouts', () => {
    expect(isTransientConnectionError({ code: 'ECONNRESET' })).toBe(true);
    expect(
      isTransientConnectionError(
        new Error('timeout exceeded when trying to connect'),
      ),
    ).toBe(true);
  });

  it('does not treat auth or query errors as transient', () => {
    expect(
      isTransientConnectionError(new Error('password authentication failed')),
    ).toBe(false);
  });
});
