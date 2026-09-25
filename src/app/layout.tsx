import type { Metadata, Viewport } from 'next';
import { Bricolage_Grotesque, Instrument_Sans } from 'next/font/google';
import './globals.css';
import { SiteFooter } from '@/components/legal/SiteFooter';

// Both families carry the full Turkish set (ş ğ ı İ ç ö ü). `latin-ext` is not
// optional here — without it, half the interface renders in a fallback face.
const display = Bricolage_Grotesque({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-display',
  display: 'swap',
  weight: ['500', '600', '700'],
});

const body = Instrument_Sans({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-body',
  display: 'swap',
});

export const metadata: Metadata = {
  title: 'Kaktüs Koçluk — YKS koçunu kendin seç',
  description:
    'Paket satın almadan önce koçunu tanı. Alanına, hedefine ve çalışma tarzına göre eşleşen YKS koçlarını gör, kendi teklifini gönder.',
};

export const viewport: Viewport = {
  themeColor: '#1E6B4B',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-dvh">
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
