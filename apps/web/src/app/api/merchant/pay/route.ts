import crypto from 'crypto';
import { eq, and } from 'drizzle-orm';
import { NextRequest, NextResponse } from 'next/server';
import { merchantAccounts, merchantCollections, merchantPaymentLinks, users, wallets, depositRequests } from '@ntzs/db';
import { db } from '@/lib/merchant/db';
import { initiatePayment, isValidTanzanianPhone, normalizePhone } from '@/lib/psp/snippe';
import { getDb } from '@/lib/db';

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://www.ntzs.co.tz';

export async function POST(req: NextRequest) {
  let body: { handle: string; amountTzs: number; phone: string; payerName?: string; linkId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const { handle, amountTzs, phone, payerName, linkId } = body;

  if (!handle || !phone) {
    return NextResponse.json({ error: 'handle and phone are required' }, { status: 400 });
  }

  if (!amountTzs || !Number.isFinite(amountTzs) || amountTzs < 100) {
    return NextResponse.json({ error: 'amountTzs must be at least 100' }, { status: 400 });
  }

  if (!isValidTanzanianPhone(phone)) {
    return NextResponse.json({ error: 'Enter a valid Tanzanian phone number' }, { status: 400 });
  }

  const [merchant] = await db
    .select({
      id: merchantAccounts.id,
      email: merchantAccounts.email,
      businessName: merchantAccounts.businessName,
      walletAddress: merchantAccounts.walletAddress,
      settlePct: merchantAccounts.settlePct,
      isActive: merchantAccounts.isActive,
    })
    .from(merchantAccounts)
    .where(eq(merchantAccounts.handle, handle.toLowerCase()))
    .limit(1);

  if (!merchant || !merchant.isActive) {
    return NextResponse.json({ error: 'Merchant not found or inactive' }, { status: 404 });
  }

  // Validate against fixed-amount link if provided
  let paymentLinkId: string | null = linkId ?? null;
  if (linkId) {
    const [link] = await db
      .select({ amountTzs: merchantPaymentLinks.amountTzs, type: merchantPaymentLinks.type, isActive: merchantPaymentLinks.isActive })
      .from(merchantPaymentLinks)
      .where(and(eq(merchantPaymentLinks.id, linkId), eq(merchantPaymentLinks.merchantId, merchant.id)))
      .limit(1);

    if (!link || !link.isActive) {
      return NextResponse.json({ error: 'Payment link not found or inactive' }, { status: 404 });
    }

    if (link.type === 'fixed' && link.amountTzs && Math.trunc(amountTzs) !== link.amountTzs) {
      return NextResponse.json({ error: 'Amount does not match link amount' }, { status: 400 });
    }
  }

  const { db: mainDb, sql } = getDb();

  // Resolve or create synthetic merchant user in main DB
  const syntheticNeonId = `merchant_${merchant.walletAddress.toLowerCase()}`;

  let [mUser] = await mainDb
    .select({ id: users.id })
    .from(users)
    .where(eq(users.neonAuthUserId, syntheticNeonId))
    .limit(1);

  if (!mUser) {
    const [created] = await mainDb
      .insert(users)
      .values({ neonAuthUserId: syntheticNeonId, email: merchant.email, role: 'end_user' })
      .onConflictDoNothing()
      .returning({ id: users.id });

    if (!created) {
      const [refetch] = await mainDb.select({ id: users.id }).from(users).where(eq(users.neonAuthUserId, syntheticNeonId)).limit(1);
      if (!refetch) return NextResponse.json({ error: 'Failed to resolve merchant user' }, { status: 500 });
      mUser = refetch;
    } else {
      mUser = created;
    }
  }

  // Resolve or create wallet record
  let [mWallet] = await mainDb
    .select({ id: wallets.id })
    .from(wallets)
    .where(and(eq(wallets.userId, mUser.id), eq(wallets.chain, 'base')))
    .limit(1);

  if (!mWallet) {
    const [created] = await mainDb
      .insert(wallets)
      .values({ userId: mUser.id, chain: 'base', address: merchant.walletAddress, provider: 'external' })
      .onConflictDoNothing()
      .returning({ id: wallets.id });

    if (!created) {
      const [refetch] = await mainDb.select({ id: wallets.id }).from(wallets).where(and(eq(wallets.userId, mUser.id), eq(wallets.chain, 'base'))).limit(1);
      if (!refetch) return NextResponse.json({ error: 'Failed to resolve merchant wallet' }, { status: 500 });
      mWallet = refetch;
    } else {
      mWallet = created;
    }
  }

  // Resolve sentinel bank for merchant collections
  const bankRows = await sql<{ id: string }[]>`
    insert into banks (name, status) values ('nTZS Merchant', 'active')
    on conflict (name) do update set status = 'active'
    returning id
  `;
  const bankId = bankRows[0]?.id;
  if (!bankId) return NextResponse.json({ error: 'Failed to resolve bank' }, { status: 500 });

  const amountInt = Math.trunc(amountTzs);
  const idempotencyKey = crypto.randomUUID();

  const [deposit] = await mainDb
    .insert(depositRequests)
    .values({
      userId: mUser.id,
      bankId,
      walletId: mWallet.id,
      chain: 'base',
      amountTzs: amountInt,
      idempotencyKey,
      status: 'submitted',
      paymentProvider: 'snippe',
      buyerPhone: normalizePhone(phone),
      source: 'merchant_collection',
      payerName: payerName || null,
    })
    .returning({ id: depositRequests.id });

  if (!deposit) {
    return NextResponse.json({ error: 'Failed to create deposit request' }, { status: 500 });
  }

  // Record merchant collection (snapshots settlePct for auto-settlement)
  const settlePct = merchant.settlePct;
  const [collection] = await db
    .insert(merchantCollections)
    .values({
      merchantId: merchant.id,
      depositRequestId: deposit.id,
      paymentLinkId,
      amountTzs: amountInt,
      payerPhone: normalizePhone(phone),
      payerName: payerName || null,
      settlePct,
      settlementStatus: settlePct > 0 ? 'pending' : 'skipped',
    })
    .returning({ id: merchantCollections.id });

  // Initiate mobile money push
  const webhookUrl = `${APP_URL}/api/webhooks/snippe/payment`;
  const snippeResult = await initiatePayment({
    amountTzs: amountInt,
    phoneNumber: phone,
    customerEmail: merchant.email,
    customerFirstname: payerName || 'Customer',
    webhookUrl,
    metadata: { deposit_request_id: deposit.id },
  });

  if (!snippeResult.success) {
    await mainDb
      .update(depositRequests)
      .set({ status: 'cancelled', updatedAt: new Date() })
      .where(eq(depositRequests.id, deposit.id));

    return NextResponse.json(
      { error: snippeResult.error || 'Failed to send payment prompt' },
      { status: 502 }
    );
  }

  await mainDb
    .update(depositRequests)
    .set({ pspReference: snippeResult.reference, updatedAt: new Date() })
    .where(eq(depositRequests.id, deposit.id));

  return NextResponse.json({ depositId: deposit.id, status: 'submitted' }, { status: 201 });
}
