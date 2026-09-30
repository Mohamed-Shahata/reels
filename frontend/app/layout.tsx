import type { Metadata } from 'next';
import { Amiri, Cairo } from 'next/font/google';
import { AuthProvider } from '@/components/auth/auth-provider';
import '@/lib/env';
import './globals.css';

const cairo = Cairo({
  subsets: ['arabic', 'latin'],
  variable: '--font-cairo',
  display: 'swap',
});

const amiri = Amiri({
  subsets: ['arabic', 'latin'],
  weight: ['400', '700'],
  variable: '--font-amiri',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Podcast Reels',
  description: 'Turn long podcast videos into short reels.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="en"
      className={`h-full antialiased ${cairo.variable} ${amiri.variable}`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
