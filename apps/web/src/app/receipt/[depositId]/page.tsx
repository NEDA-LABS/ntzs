import { eq } from 'drizzle-orm';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';

import { getDb } from '@/lib/db';
import {
  depositRequests,
  merchantAccounts,
  merchantCollections,
  merchantPaymentLinks,
} from '@ntzs/db';
import { PrintButton } from './PrintButton';

interface Props {
  params: Promise<{ depositId: string }>;
}

function receiptNo(collectionId: string, date: Date): string {
  const hex = collectionId.replace(/-/g, '').slice(0, 8).toUpperCase();
  const d = date.toISOString().slice(0, 10).replace(/-/g, '');
  return `RCP-${hex}-${d}`;
}

function maskPhone(phone: string): string {
  const clean = phone.replace(/\D/g, '');
  if (clean.length < 7) return phone;
  return clean.slice(0, -6) + '•••' + clean.slice(-3);
}

function formatChannel(channel: string | null): string {
  if (!channel) return 'Mobile Money';
  const map: Record<string, string> = {
    'MPESA-TZ': 'M-PESA',
    'TIGO-TZ': 'Tigo Pesa',
    'AIRTEL-TZ': 'Airtel Money',
    'HALOTEL-TZ': 'Halotel',
  };
  return map[channel] ?? channel;
}

async function getReceiptData(depositId: string) {
  const { db } = getDb();

  const [row] = await db
    .select({
      collectionId: merchantCollections.id,
      amountTzs: merchantCollections.amountTzs,
      payerName: merchantCollections.payerName,
      payerPhone: merchantCollections.payerPhone,
      collectionStatus: merchantCollections.collectionStatus,
      createdAt: merchantCollections.createdAt,
      merchantBusinessName: merchantAccounts.businessName,
      merchantHandle: merchantAccounts.handle,
      productName: merchantPaymentLinks.productName,
      linkDescription: merchantPaymentLinks.description,
      pspReference: depositRequests.pspReference,
      pspChannel: depositRequests.pspChannel,
    })
    .from(merchantCollections)
    .innerJoin(merchantAccounts, eq(merchantCollections.merchantId, merchantAccounts.id))
    .leftJoin(merchantPaymentLinks, eq(merchantCollections.paymentLinkId, merchantPaymentLinks.id))
    .innerJoin(depositRequests, eq(merchantCollections.depositRequestId, depositRequests.id))
    .where(eq(merchantCollections.depositRequestId, depositId))
    .limit(1);

  return row ?? null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { depositId } = await params;
  const row = await getReceiptData(depositId);
  if (!row) return { title: 'Receipt Not Found' };
  const name = row.merchantBusinessName || `@${row.merchantHandle}`;
  return {
    title: `Receipt — ${name}`,
    description: `Payment receipt for ${row.amountTzs.toLocaleString()} TZS paid to ${name}`,
  };
}

export default async function ReceiptPage({ params }: Props) {
  const { depositId } = await params;
  const row = await getReceiptData(depositId);

  if (!row || row.collectionStatus !== 'minted') notFound();

  const merchant = row.merchantBusinessName || `@${row.merchantHandle}`;
  const rcp = receiptNo(row.collectionId, row.createdAt);
  const paidAt = new Date(row.createdAt);
  const dateStr = paidAt.toLocaleDateString('en-TZ', {
    year: 'numeric', month: 'long', day: 'numeric',
  });
  const timeStr = paidAt.toLocaleTimeString('en-TZ', {
    hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Africa/Dar_es_Salaam',
  });

  return (
    <>
      {/* Print styles injected inline — keeps this a server component */}
      <style>{`
        @media print {
          .no-print { display: none !important; }
          body { background: white !important; }
          @page { margin: 12mm; size: A5 portrait; }
        }
      `}</style>

      <div className="min-h-screen bg-zinc-100 font-mono" style={{ colorScheme: 'light' }}>

        {/* Top bar */}
        <div className="no-print border-b border-zinc-200 bg-white px-6 py-3 flex items-center justify-between">
          <span className="text-[10px] tracking-widest text-zinc-400 uppercase">nTZS / Receipt</span>
          <PrintButton />
        </div>

        <div className="max-w-lg mx-auto px-4 py-8">
          <div className="bg-white border border-zinc-200 shadow-sm">

            {/* Header */}
            <div className="border-b border-zinc-100 px-8 py-6 flex items-start justify-between">
              <div>
                <p className="text-[9px] tracking-widest text-zinc-400 uppercase mb-1">nTZS Network</p>
                <p className="text-lg font-bold text-zinc-900 tracking-wide">Payment Receipt</p>
              </div>
              <div className="text-right">
                <span className="inline-flex items-center gap-1.5 border border-emerald-200 bg-emerald-50 px-2.5 py-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  <span className="text-[9px] font-bold tracking-widest text-emerald-700 uppercase">Paid</span>
                </span>
              </div>
            </div>

            {/* Receipt number + date */}
            <div className="border-b border-zinc-100 bg-zinc-50 px-8 py-4 flex items-center justify-between">
              <div>
                <p className="text-[9px] tracking-widest text-zinc-400 uppercase mb-0.5">Receipt No.</p>
                <p className="text-xs font-bold text-zinc-700 tracking-wider">{rcp}</p>
              </div>
              <div className="text-right">
                <p className="text-[9px] tracking-widest text-zinc-400 uppercase mb-0.5">Date &amp; Time</p>
                <p className="text-xs text-zinc-600">{dateStr}</p>
                <p className="text-[10px] text-zinc-400">{timeStr} EAT</p>
              </div>
            </div>

            {/* Amount */}
            <div className="border-b border-zinc-100 px-8 py-6 text-center">
              <p className="text-[9px] tracking-widest text-zinc-400 uppercase mb-2">Amount Paid</p>
              <p className="text-4xl font-bold text-zinc-900 tracking-tight">
                {row.amountTzs.toLocaleString()}
                <span className="ml-2 text-lg font-normal text-zinc-400">TZS</span>
              </p>
            </div>

            {/* Transaction details */}
            <div className="px-8 py-6 space-y-4">

              <div className="flex items-start justify-between">
                <span className="text-[9px] tracking-widest text-zinc-400 uppercase w-28 shrink-0 mt-0.5">Paid To</span>
                <span className="text-sm font-semibold text-zinc-800 text-right">{merchant}</span>
              </div>

              {(row.productName || row.linkDescription) && (
                <div className="flex items-start justify-between">
                  <span className="text-[9px] tracking-widest text-zinc-400 uppercase w-28 shrink-0 mt-0.5">
                    {row.productName ? 'Product' : 'Description'}
                  </span>
                  <span className="text-sm text-zinc-700 text-right">
                    {row.productName || row.linkDescription}
                  </span>
                </div>
              )}

              <div className="flex items-start justify-between">
                <span className="text-[9px] tracking-widest text-zinc-400 uppercase w-28 shrink-0 mt-0.5">Paid By</span>
                <span className="text-sm text-zinc-700 text-right">
                  {row.payerName || 'Customer'}
                  {row.payerPhone && (
                    <span className="block text-[10px] text-zinc-400">{maskPhone(row.payerPhone)}</span>
                  )}
                </span>
              </div>

              <div className="flex items-start justify-between">
                <span className="text-[9px] tracking-widest text-zinc-400 uppercase w-28 shrink-0 mt-0.5">Method</span>
                <span className="text-sm text-zinc-700 text-right">{formatChannel(row.pspChannel)}</span>
              </div>

              {row.pspReference && (
                <div className="flex items-start justify-between">
                  <span className="text-[9px] tracking-widest text-zinc-400 uppercase w-28 shrink-0 mt-0.5">Reference</span>
                  <span className="text-xs font-mono text-zinc-500 text-right break-all">{row.pspReference}</span>
                </div>
              )}

            </div>

            {/* Divider + footer */}
            <div className="border-t border-dashed border-zinc-200 mx-8" />

            <div className="px-8 py-5">
              <p className="text-[9px] text-zinc-400 leading-relaxed text-center">
                This receipt confirms payment was successfully received via nTZS Network.<br />
                Valid for tax and accounting purposes. Retain for your records.<br />
                <span className="text-zinc-300">nTZS · Tanzania Shilling Stablecoin · ntzs.co.tz</span>
              </p>
            </div>

          </div>

          {/* Print CTA below card */}
          <div className="no-print mt-5 flex flex-col items-center gap-3">
            <PrintButton />
            <p className="text-[10px] text-zinc-400 tracking-wide">
              In print dialog, set destination to <strong>Save as PDF</strong>
            </p>
          </div>
        </div>

      </div>
    </>
  );
}
