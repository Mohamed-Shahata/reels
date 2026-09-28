import type { Metadata } from 'next';
import { AuthProvider } from '@/components/auth/auth-provider';
import '@/lib/env';
import './globals.css';

export const metadata: Metadata = {
  title: 'Podcast Reels',
  description: 'Turn long podcast videos into short reels.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
