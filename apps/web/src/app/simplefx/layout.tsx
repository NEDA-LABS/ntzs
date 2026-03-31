import type { Metadata } from 'next';
import './simplefx.css';

export const metadata: Metadata = {
  title: 'SimpleFX — The Open TZS Liquidity Market',
  description:
    'Provide nTZS liquidity. Set your spread. Earn fees on every swap filled — automatically.',
};

export default function SimpleFXLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="font-mono antialiased bg-black text-white min-h-screen">
      {children}
    </div>
  );
}
