import { eq, and } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { db } from '@/lib/merchant/db';
import { merchantAccounts, merchantPaymentLinks } from '@ntzs/db';
import { MerchantPayForm } from './MerchantPayForm';

interface Props {
  params: Promise<{ handle: string }>;
  searchParams: Promise<{ link?: string; amount?: string }>;
}

export async function generateMetadata({ params, searchParams }: Props): Promise<Metadata> {
  const { handle } = await params;
  const { link: linkId } = await searchParams;

  const [merchant] = await db
    .select({
      id: merchantAccounts.id,
      businessName: merchantAccounts.businessName,
      handle: merchantAccounts.handle,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.handle, handle.toLowerCase()))
    .limit(1);

  if (!merchant) return { title: 'nTZS Biashara' };

  const displayName = merchant.businessName || `@${merchant.handle}`;
  let title = `Pay ${displayName}`;
  let description = `Send a secure mobile payment to ${displayName} via nTZS`;
  let ogImage: string | undefined;

  if (linkId) {
    const [link] = await db
      .select()
      .from(merchantPaymentLinks)
      .where(
        and(
          eq(merchantPaymentLinks.id, linkId),
          eq(merchantPaymentLinks.merchantId, merchant.id),
          eq(merchantPaymentLinks.isActive, true),
        )
      )
      .limit(1);

    if (link) {
      if (link.productName) title = `${link.productName} · ${displayName}`;

      const parts: string[] = [];
      if (link.amountTzs) parts.push(`${link.amountTzs.toLocaleString()} TZS`);
      if (link.discountPct && link.originalAmountTzs) parts.push(`${link.discountPct}% off`);
      if (link.description) parts.push(link.description);
      parts.push(`Pay via nTZS`);
      description = parts.join(' · ');

      // Only use as OG image if it's a real public URL — base64 data URIs don't work in OG
      if (link.imageUrl && (link.imageUrl.startsWith('http://') || link.imageUrl.startsWith('https://'))) {
        ogImage = link.imageUrl;
      }
    }
  }

  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      ...(ogImage && {
        images: [{ url: ogImage, width: 1200, height: 630, alt: title }],
      }),
    },
    twitter: {
      card: ogImage ? 'summary_large_image' : 'summary',
      title,
      description,
      ...(ogImage && { images: [ogImage] }),
    },
  };
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
  let originalAmount: number | null = null;
  let discountPct = 0;
  let linkDescription: string | null = null;
  let productName: string | null = null;
  let imageUrl: string | null = null;
  let resolvedLinkId: string | null = null;

  if (linkId) {
    const [link] = await db
      .select()
      .from(merchantPaymentLinks)
      .where(and(eq(merchantPaymentLinks.id, linkId), eq(merchantPaymentLinks.merchantId, merchant.id)))
      .limit(1);

    if (link && link.isActive) {
      resolvedLinkId = link.id;
      linkDescription = link.description;
      productName = link.productName;
      imageUrl = link.imageUrl;
      discountPct = link.discountPct ?? 0;
      originalAmount = link.originalAmountTzs;
      if (link.type === 'fixed' && link.amountTzs) fixedAmount = link.amountTzs;
    }
  }

  const displayName = merchant.businessName || `@${merchant.handle}`;
  const initial = (merchant.businessName || merchant.handle)[0].toUpperCase();
  const hasDiscount = discountPct > 0 && originalAmount;

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

        {/* Product card (when a product link is used) */}
        {imageUrl ? (
          <div className="relative border border-white/10 bg-white/[0.02] overflow-hidden mb-5">
            <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-emerald-500/25" />
            <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-emerald-500/25" />

            {/* Hero image */}
            <div className="relative h-52 w-full overflow-hidden">
              <img src={imageUrl} alt={productName ?? displayName} className="w-full h-full object-cover" />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

              {/* Discount badge */}
              {hasDiscount && (
                <div className="absolute top-3 left-3 border border-emerald-400/70 bg-black/80 px-2.5 py-1 backdrop-blur-sm">
                  <span className="text-[10px] font-bold tracking-widest text-emerald-400 uppercase">
                    Save {discountPct}%
                  </span>
                </div>
              )}

              {/* Merchant tag */}
              <div className="absolute bottom-3 right-3 flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center border border-white/30 bg-black/60 text-[10px] font-bold text-white backdrop-blur-sm">
                  {initial}
                </div>
                <span className="text-[10px] text-white/60 tracking-wide">{displayName}</span>
              </div>
            </div>

            {/* Product details */}
            <div className="px-5 py-4">
              {productName && (
                <p className="text-base font-bold text-white tracking-wide mb-2">{productName}</p>
              )}
              <div className="flex items-center gap-3 mb-1">
                {fixedAmount && (
                  <span className="text-xl font-bold text-emerald-400">{fixedAmount.toLocaleString()} TZS</span>
                )}
                {hasDiscount && originalAmount && (
                  <>
                    <span className="text-sm text-white/30 line-through">{originalAmount.toLocaleString()} TZS</span>
                    <span className="border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-medium text-emerald-400 tracking-wider uppercase">
                      -{discountPct}%
                    </span>
                  </>
                )}
              </div>
              {linkDescription && (
                <p className="text-xs text-white/35 leading-relaxed mt-1">{linkDescription}</p>
              )}
            </div>
          </div>
        ) : (
          /* No product image — simple merchant identity header */
          <div className="mb-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-4 h-px bg-white/20" />
              <span className="text-[10px] tracking-widest text-white/25 uppercase">
                {productName || linkDescription ? 'Payment For' : 'Pay To'}
              </span>
              <div className="flex-1 h-px bg-white/5" />
            </div>
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-emerald-500/30 bg-emerald-500/5 text-lg font-bold text-emerald-400">
                {initial}
              </div>
              <div>
                <p className="text-base font-bold text-white tracking-wide">
                  {productName || linkDescription || displayName}
                </p>
                {(productName || linkDescription) && (
                  <p className="text-xs text-white/35 mt-0.5">{displayName}</p>
                )}
                {fixedAmount && hasDiscount && (
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-sm font-bold text-emerald-400">{fixedAmount.toLocaleString()} TZS</span>
                    <span className="text-xs text-white/30 line-through">{originalAmount!.toLocaleString()} TZS</span>
                    <span className="border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] text-emerald-400 uppercase tracking-wider">-{discountPct}%</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Pay form */}
        <div className="relative border border-white/10 p-6 bg-white/[0.02]">
          <div className="absolute top-0 left-0 w-4 h-4 border-t border-l border-emerald-500/25" />
          <div className="absolute top-0 right-0 w-4 h-4 border-t border-r border-emerald-500/25" />
          <div className="absolute bottom-0 left-0 w-4 h-4 border-b border-l border-emerald-500/25" />
          <div className="absolute bottom-0 right-0 w-4 h-4 border-b border-r border-emerald-500/25" />

          <MerchantPayForm
            handle={merchant.handle}
            displayName={productName || displayName}
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
