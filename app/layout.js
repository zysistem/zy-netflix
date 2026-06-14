import './globals.css';

export const metadata = {
  title: 'ZY Netflix — Film & Dizi Platformu',
  description: 'Netflix tarzı film ve dizi keşif platformu',
};

export const viewport = {
  themeColor: '#141414',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="tr">
      <body>{children}</body>
    </html>
  );
}
