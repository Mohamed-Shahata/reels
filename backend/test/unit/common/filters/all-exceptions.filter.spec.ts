import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  NotFoundException,
} from '@nestjs/common';
import {
  AllExceptionsFilter,
  ErrorResponseBody,
} from '../../../../src/common/filters/all-exceptions.filter';

function createHost() {
  const json = jest.fn<void, [ErrorResponseBody]>();
  const status = jest
    .fn<{ json: typeof json }, [number]>()
    .mockReturnValue({ json });
  const request = {
    method: 'GET',
    originalUrl: '/api/v1/test',
    headers: { 'x-request-id': 'req-1' },
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => ({ status }),
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  const filter = new AllExceptionsFilter();

  it('formats http exceptions with a consistent shape', () => {
    const { host, status, json } = createHost();

    filter.catch(new NotFoundException('Video not found'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 404,
        error: 'Not Found',
        message: 'Video not found',
        path: '/api/v1/test',
        requestId: 'req-1',
        timestamp: expect.any(String) as string,
      }),
    );
  });

  it('keeps structured details from validation errors', () => {
    const { host, json } = createHost();
    const details = [{ field: 'email', messages: ['email must be an email'] }];

    filter.catch(
      new BadRequestException({ message: 'Validation failed', details }),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        statusCode: 400,
        message: 'Validation failed',
        details,
      }),
    );
  });

  it('hides internal error messages for unknown exceptions', () => {
    const { host, status, json } = createHost();

    filter.catch(new Error('database password leaked'), host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    const [body] = json.mock.calls[0];
    expect(body.message).toBe('Internal server error');
  });
});
