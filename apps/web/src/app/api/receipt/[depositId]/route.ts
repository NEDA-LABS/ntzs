import { eq } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';

import { getDb } from '@/lib/db';
import {
  depositRequests,
  merchantAccounts,
  merchantCollections,
  merchantPaymentLinks,
} from '@ntzs/db';

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ depositId: string }> }
) {
  const { depositId } = await params;
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

  if (!row || row.collectionStatus !== 'minted') {
    return NextResponse.json({ error: 'Receipt not found' }, { status: 404 });
  }

  return NextResponse.json({ depositId, ...row });
}
