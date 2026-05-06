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

      if (link.imageUrl) {
        const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'https://www.ntzs.co.tz';
        ogImage = `${appUrl}/api/merchant/image/${linkId}`;
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
  let promoUrl: string | null = null;
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
      promoUrl = link.promoUrl ?? null;
      discountPct = link.discountPct ?? 0;
      originalAmount = link.originalAmountTzs;
      if (link.type === 'fixed' && link.amountTzs) fixedAmount = link.amountTzs;
    }
  }

  const displayName = merchant.businessName || `@${merchant.handle}`;
  const initial = (merchant.businessName || merchant.handle)[0].toUpperCase();
  const hasDiscount = discountPct > 0 && originalAmount;

  // Compute embed details from promoUrl server-side
  let promoEmbed: { type: 'iframe'; src: string; portrait: boolean } | { type: 'link'; href: string; platform: string } | null = null;
  if (promoUrl) {
    const ytMatch = promoUrl.match(/(?:[?&]v=|youtu\.be\/|\/shorts\/)([a-zA-Z0-9_-]{11})/);
    const ttMatch = promoUrl.match(/tiktok\.com.*\/video\/(\d+)/);
    const igMatch = promoUrl.match(/instagram\.com\/(?:reel|p)\/([A-Za-z0-9_-]+)/);
    if (ytMatch) {
      promoEmbed = { type: 'iframe', src: `https://www.youtube.com/embed/${ytMatch[1]}?playsinline=1&rel=0`, portrait: false };
    } else if (ttMatch) {
      promoEmbed = { type: 'iframe', src: `https://www.tiktok.com/embed/v2/${ttMatch[1]}`, portrait: true };
    } else if (igMatch) {
      promoEmbed = { type: 'link', href: promoUrl, platform: 'Instagram' };
    }
  }

  return (
    <div className="min-h-screen bg-zinc-50 font-mono text-zinc-900" style={{ colorScheme: 'light' }}>

      {/* Top bar */}
      <div className="border-b border-zinc-100 bg-white px-6 py-3 flex items-center justify-between">
        <span className="text-[10px] tracking-widest text-zinc-400 uppercase">nTZS / Biashara</span>
        <div className="flex items-center gap-2">
          <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-[10px] tracking-widest text-zinc-400 uppercase">Secure Payment</span>
        </div>
      </div>

      <div className="max-w-md mx-auto px-4 py-8">

        {/* Product card */}
        {imageUrl ? (
          <div className="bg-white border border-zinc-100 overflow-hidden mb-5 shadow-sm">
            <div className="relative h-52 w-full overflow-hidden">
              <img src={imageUrl} alt={productName ?? displayName} className="w-full h-full object-cover" />

              {hasDiscount && (
                <div className="absolute top-3 left-3 bg-emerald-500 px-2.5 py-1">
                  <span className="text-[10px] font-bold tracking-widest text-white uppercase">
                    Save {discountPct}%
                  </span>
                </div>
              )}

              {/* Merchant tag */}
              <div className="absolute bottom-3 right-3 flex items-center gap-2 bg-white/90 border border-white/60 px-2.5 py-1 backdrop-blur-sm">
                <div className="flex h-4 w-4 items-center justify-center bg-emerald-50 border border-emerald-100 text-[8px] font-bold text-emerald-600">
                  {initial}
                </div>
                <span className="text-[10px] text-zinc-500 tracking-wide">{displayName}</span>
              </div>
            </div>

            <div className="px-5 py-4">
              {productName && (
                <p className="text-base font-bold text-zinc-900 tracking-wide mb-2">{productName}</p>
              )}
              <div className="flex items-center gap-3 mb-1 flex-wrap">
                {fixedAmount && (
                  <span className="text-xl font-bold text-emerald-600">{fixedAmount.toLocaleString()} TZS</span>
                )}
                {hasDiscount && originalAmount && (
                  <>
                    <span className="text-sm text-zinc-300 line-through">{originalAmount.toLocaleString()} TZS</span>
                    <span className="border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-600 tracking-wider uppercase">
                      -{discountPct}%
                    </span>
                  </>
                )}
              </div>
              {linkDescription && (
                <p className="text-xs text-zinc-400 leading-relaxed mt-1">{linkDescription}</p>
              )}
            </div>
          </div>

        ) : (
          /* No product image — merchant identity header */
          <div className="mb-6 bg-white border border-zinc-100 px-5 py-4 shadow-sm">
            <p className="text-[10px] tracking-widest text-zinc-300 uppercase mb-3">
              {productName || linkDescription ? 'Payment For' : 'Pay To'}
            </p>
            <div className="flex items-center gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-emerald-100 bg-emerald-50 text-lg font-bold text-emerald-600">
                {initial}
              </div>
              <div>
                <p className="text-base font-bold text-zinc-900 tracking-wide">
                  {productName || displayName}
                </p>
                {productName && (
                  <p className="text-xs text-zinc-400 mt-0.5">{displayName}</p>
                )}
                {fixedAmount && hasDiscount && (
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-sm font-bold text-emerald-600">{fixedAmount.toLocaleString()} TZS</span>
                    <span className="text-xs text-zinc-300 line-through">{originalAmount!.toLocaleString()} TZS</span>
                    <span className="border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[9px] text-emerald-600 uppercase tracking-wider">-{discountPct}%</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Promo video embed */}
        {promoEmbed && (
          <div className="bg-white border border-zinc-100 overflow-hidden mb-5 shadow-sm">
            <div className="px-4 py-2.5 border-b border-zinc-50 flex items-center justify-between">
              <span className="text-[10px] tracking-widest text-zinc-400 uppercase">Watch Promo</span>
              {promoUrl && (
                <a
                  href={promoUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] tracking-widest text-zinc-300 uppercase hover:text-zinc-500 transition-colors"
                >
                  Open ↗
                </a>
              )}
            </div>
            {promoEmbed.type === 'iframe' ? (
              <div className={promoEmbed.portrait ? 'relative mx-auto max-w-[280px] aspect-[9/16]' : 'relative w-full aspect-video'}>
                <iframe
                  src={promoEmbed.src}
                  className="absolute inset-0 w-full h-full"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            ) : (
              <a
                href={promoEmbed.href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-4 px-5 py-6 hover:bg-zinc-50 transition-colors"
              >
                <div className="flex h-11 w-11 shrink-0 items-center justify-center border border-purple-100 bg-purple-50">
                  <span className="text-purple-500 text-base leading-none">▶</span>
                </div>
                <div>
                  <p className="text-sm font-semibold text-zinc-800">Watch on Instagram</p>
                  <p className="text-[10px] text-zinc-400 mt-0.5 tracking-wide">Tap to view the promo reel</p>
                </div>
              </a>
            )}
          </div>
        )}

        {/* Pay form */}
        <div className="bg-white border border-zinc-100 p-6 shadow-sm">
          <MerchantPayForm
            handle={merchant.handle}
            displayName={productName || displayName}
            fixedAmount={fixedAmount}
            description={linkDescription}
            initialAmount={amountParam}
            linkId={resolvedLinkId}
          />
        </div>

        <p className="mt-6 text-center text-[10px] tracking-widest text-zinc-300 uppercase">
          Powered by nTZS Network · Secure Mobile Payments
        </p>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-zinc-100 px-6 py-3 flex items-center justify-between">
        <span className="text-[10px] tracking-widest text-zinc-300 uppercase">nTZS</span>
        <span className="text-[10px] tracking-widest text-zinc-300 uppercase">Tanzania Shilling Stablecoin</span>
      </div>
    </div>
  );
}
