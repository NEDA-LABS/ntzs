import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'nTZS Biashara',
  description: 'Accept payments and manage your business with nTZS',
};

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <style>{`
        html, body { background: #000 !important; height: 100%; margin: 0; padding: 0; }
      `}</style>
      {children}
    </>
  );
}
