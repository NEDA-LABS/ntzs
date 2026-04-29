import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'nTZS Biashara',
  description: 'Accept payments and manage your business with nTZS',
};

export default function MerchantLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
