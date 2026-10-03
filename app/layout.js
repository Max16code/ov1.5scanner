import './globals.css';

export const metadata = {
  title: 'Over 1.5 Scanner',
  description: 'Scans top leagues for high-probability Over 1.5 goals fixtures',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
