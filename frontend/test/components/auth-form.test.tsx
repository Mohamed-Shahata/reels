import { AuthForm } from '@/components/auth/auth-form';
import { useAuth } from '@/components/auth/auth-provider';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockPush = jest.fn();
const mockReplace = jest.fn();

jest.mock('next/navigation', () => ({
  useRouter: () => ({ push: mockPush, replace: mockReplace }),
}));

jest.mock('@/components/auth/auth-provider', () => ({
  useAuth: jest.fn(),
}));

describe('AuthForm', () => {
  const mockLogin = jest.fn();
  const mockRegister = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useAuth as jest.Mock).mockReturnValue({
      login: mockLogin,
      register: mockRegister,
      status: 'unauthenticated',
    });
  });

  it('renders login form and handles submission', async () => {
    mockLogin.mockResolvedValueOnce(undefined);

    render(<AuthForm mode="login" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /Welcome back|مرحباً/i,
    );
    expect(screen.getByLabelText(/EMAIL/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^PASSWORD/i)).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/EMAIL/i), {
      target: { value: 'test@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^PASSWORD/i), {
      target: { value: 'password123' },
    });

    const submitBtn = screen.getByRole('button', { name: /Sign in|تسجيل الدخول/i });
    fireEvent.click(submitBtn);

    await waitFor(() => {
      expect(mockLogin).toHaveBeenCalledWith('test@example.com', 'password123');
      expect(mockReplace).toHaveBeenCalledWith('/');
    });
  });

  it('shows error on invalid email format', async () => {
    render(<AuthForm mode="login" />);

    fireEvent.change(screen.getByLabelText(/EMAIL/i), {
      target: { value: 'not-an-email' },
    });
    fireEvent.change(screen.getByLabelText(/^PASSWORD/i), {
      target: { value: 'password123' },
    });

    fireEvent.click(screen.getByRole('button', { name: /Sign in|تسجيل الدخول/i }));

    expect(
      await screen.findByText(/Enter a valid email address/i),
    ).toBeInTheDocument();
    expect(mockLogin).not.toHaveBeenCalled();
  });

  it('renders register form with password requirements', async () => {
    mockRegister.mockResolvedValueOnce(undefined);

    render(<AuthForm mode="register" />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      /Create your account|إنشاء حساب/i,
    );
    expect(
      screen.getByText(/PASSWORD REQUIREMENTS|متطلبات كلمة المرور/i),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText(/EMAIL/i), {
      target: { value: 'newuser@example.com' },
    });
    fireEvent.change(screen.getByLabelText(/^PASSWORD/i), {
      target: { value: 'Secret123' },
    });

    fireEvent.click(
      screen.getByRole('button', { name: /Create account|إنشاء حساب/i }),
    );

    await waitFor(() => {
      expect(mockRegister).toHaveBeenCalledWith(
        'newuser@example.com',
        'Secret123',
      );
    });
  });

  it('toggles password visibility', () => {
    render(<AuthForm mode="login" />);

    const passwordInput = screen.getByLabelText(/^PASSWORD/i);
    expect(passwordInput).toHaveAttribute('type', 'password');

    const toggleBtn = screen.getByRole('button', {
      name: /Show password|إظهار كلمة المرور/i,
    });
    fireEvent.click(toggleBtn);

    expect(passwordInput).toHaveAttribute('type', 'text');
  });
});
