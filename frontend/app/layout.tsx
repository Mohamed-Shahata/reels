import type { Metadata } from 'next';
import { Amiri, Cairo } from 'next/font/google';
import { AuthProvider } from '@/components/auth/auth-provider';
import { ToastProvider } from '@/components/feedback/toast-provider';
import { LanguageProvider } from '@/lib/i18n/language-context';
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
  title: 'ReelCast',
  description: 'Turn long videos and podcasts into viral vertical clips with AI.',
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html
      lang="ar"
      dir="rtl"
      className={`h-full antialiased ${cairo.variable} ${amiri.variable}`}
      suppressHydrationWarning
    >
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var l=localStorage.getItem('reelcast_language')||'ar';document.documentElement.lang=l;document.documentElement.dir=l==='ar'?'rtl':'ltr';if(l==='ar'){document.documentElement.classList.add('rtl');document.documentElement.classList.remove('ltr');}else{document.documentElement.classList.add('ltr');document.documentElement.classList.remove('rtl');}}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <LanguageProvider>
          <AuthProvider>
            <ToastProvider>{children}</ToastProvider>
          </AuthProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
