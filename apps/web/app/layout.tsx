import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Nanawise',
  description: 'Trade BTC up/down on DeepBook Predict — no seed phrase, no gas.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <script async src="https://telegram.org/js/telegram-web-app.js"></script>
      </head>
      <body>
        {children}
      </body>
    </html>
  );
}
