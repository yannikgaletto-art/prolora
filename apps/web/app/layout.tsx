import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Prolora — Publishing API + Feedback Aggregation',
  description: 'DSGVO-konforme Publishing-API + Feedback-Aggregation für den DACH-Markt',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>{children}</body>
    </html>
  );
}
