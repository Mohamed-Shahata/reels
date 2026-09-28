import { AuthProvider, useAuth } from '@/components/auth/auth-provider';
import { ApiError, api } from '@/lib/api';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock('@/lib/api', () => {
  class MockApiError extends Error {
    constructor(
      message: string,
      readonly status: number,
    ) {
      super(message);
    }
  }

  return {
    ApiError: MockApiError,
    api: {
      getCurrentUser: jest.fn(),
      login: jest.fn(),
      logout: jest.fn(),
      refresh: jest.fn(),
      register: jest.fn(),
    },
  };
});

const mockedApi = api as jest.Mocked<typeof api>;
const user = {
  id: 'user-1',
  email: 'user@example.com',
  createdAt: '2026-09-28T10:00:00.000Z',
};

function SessionProbe() {
  const { logout, status, user: currentUser } = useAuth();

  return (
    <div>
      <span>{status}</span>
      <span>{currentUser?.email}</span>
      <button onClick={() => void logout()} type="button">
        Sign out
      </button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('refreshes the session when the access token has expired', async () => {
    mockedApi.getCurrentUser
      .mockRejectedValueOnce(new ApiError('Expired', 401))
      .mockResolvedValueOnce(user);
    mockedApi.refresh.mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <SessionProbe />
      </AuthProvider>,
    );

    await waitFor(() =>
      expect(screen.getByText('authenticated')).toBeInTheDocument(),
    );

    expect(mockedApi.refresh).toHaveBeenCalledTimes(1);
    expect(mockedApi.getCurrentUser).toHaveBeenCalledTimes(2);
    expect(screen.getByText(user.email)).toBeInTheDocument();
  });

  it('clears the current user after logout', async () => {
    mockedApi.getCurrentUser.mockResolvedValue(user);
    mockedApi.logout.mockResolvedValue(undefined);

    render(
      <AuthProvider>
        <SessionProbe />
      </AuthProvider>,
    );

    await screen.findByText('authenticated');
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));

    await waitFor(() =>
      expect(screen.getByText('unauthenticated')).toBeInTheDocument(),
    );
    expect(mockedApi.logout).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(user.email)).not.toBeInTheDocument();
  });
});
