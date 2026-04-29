import { eq, and } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import { db } from '@/lib/merchant/db';
import { merchantAccounts, merchantPaymentLinks } from '@ntzs/db';
import { MerchantPayForm } from './MerchantPayForm';

interface Props {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ link?: string; amount?: string }>;
}

export default async function MerchantPayPage({ params, searchParams }: Props) {
  const { handle } = await params;
  const { link: linkId, amount: amountParam } = await searchParams;

  const [merchant] = await db
    .select({
      id: merchantAccounts.id,
      businessName: merchantAccounts.businessName,
      handle: merchantAccounts.handle,
      isActive: merchantAccounts.isActive,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.handle, handle.toLowerCase()))
    .limit(1);

  if (!merchant || !merchant.isActive) notFound();

  let fixedAmount: number | null = null;
  let linkDescription: string | null = null;
  let resolvedLinkId: string | null = null;

  if (linkId) {
    const [link] = await db
      .select({
        id: merchantPaymentLinks.id,
        type: merchantPaymentLinks.type,
        amountTzs: merchantPaymentLinks.amountTzs,
        description: merchantPaymentLinks.description,
        isActive: merchantPaymentLinks.isActive,
      })
      .from(merchantPaymentLinks)
      .where(and(eq(merchantPaymentLinks.id, linkId), eq(merchantPaymentLinks.merchantId, merchant.id)))
      .limit(1);

    if (link && link.isActive) {
      resolvedLinkId = link.id;
      linkDescription = link.description;
      if (link.type === 'fixed' && link.amountTzs) fixedAmount = link.amountTzs;
    }
  }

  const displayName = merchant.businessName || `@${merchant.handle}`;
  const initial = (merchant.businessName || merchant.handle)[0].toUpperCase();

  return (
    <div className="relative flex min-h-screen items-center justify-center bg-black p-4 font-mono overflow-hidden">
      {/* Corner frame accents */}
      <div className="pointer-events-none absolute top-0 left-0 w-12 h-12 border-t border-l border-white/15" />
      <div className="pointer-events-none absolute top-0 right-0 w-12 h-12 border-t border-r border-white/15" />
      <div className="pointer-events-none absolute bottom-0 left-0 w-12 h-12 border-b border-l border-white/15" />
      <div className="pointer-events-none absolute bottom-0 right-0 w-12 h-12 border-b border-r border-white/15" />

      {/* Top bar */}
      <div className="pointer-events-none absolute top-0 left-0 right-0 border-b border-white/10 px-6 py-3 flex items-center justify-between">
        <span className="text-[10px] tracking-widest text-white/30 uppercase">nTZS / Biashara</span>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
          <span className="text-[10px] tracking-widest text-white/25 uppercase">Secure Payment</span>
        </div>
      </div>

      <div className="w-full max-w-md pt-8">
        {/* Merchant identity */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-4 h-px bg-white/20" />
            <span className="text-[10px] tracking-widest text-white/25 uppercase">
              {linkDescription ? 'Payment For' : 'Pay To'}
            </span>
            <div className="flex-1 h-px bg-white/5" />
          </div>

          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-emerald-500/30 bg-emerald-500/5 text-lg font-bold text-emerald-400">
              {initial}
            </div>
            <div>
              {linkDescription ? (
                <>
                  <p className="text-base font-bold text-white tracking-wide">{linkDescription}</p>
                  <p className="text-xs text-white/35 mt-0.5">{displayName}</p>
                </>
              ) : (
                <>
                  <p className="text-base font-bold text-white tracking-wide">{displayName}</p>
                  <p className="text-xs text-white/25 mt-0.5">@{merchant.handle}</p>
                </>
              )}
            </div>
          </div>
        </div>

        {/* Pay form */}
        <div className="relative border border-white/10 p-6 bg-white/[0.02]">
          <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-emerald-500/25" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-emerald-500/25" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-emerald-500/25" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-emerald-500/25" />

          <MerchantPayForm
            handle={merchant.handle}
            displayName={displayName}
            fixedAmount={fixedAmount}
            description={linkDescription}
            initialAmount={amountParam}
            linkId={resolvedLinkId}
          />
        </div>

        <p className="mt-5 text-center text-[10px] tracking-widest text-white/15 uppercase">
          Powered by nTZS Network · Secure Mobile Payments
        </p>
      </div>

      {/* Bottom bar */}
      <div className="pointer-events-none absolute bottom-0 left-0 right-0 border-t border-white/10 px-6 py-3 flex items-center justify-between">
        <span className="text-[10px] tracking-widest text-white/15 uppercase">nTZS</span>
        <span className="text-[10px] tracking-widest text-white/15 uppercase">Tanzania Shilling Stablecoin</span>
      </div>
    </div>
  );
}
