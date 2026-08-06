import { sql } from 'drizzle-orm'
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core'

export const userRole = pgEnum('user_role', [
  'end_user',
  'bank_admin',
  'platform_compliance',
  'super_admin',
  'fund_manager',
  'bot_regulator',
])

export const kycStatus = pgEnum('kyc_status', ['pending', 'approved', 'rejected'])

export const chain = pgEnum('chain', ['base', 'bnb', 'eth'])

export const walletProvider = pgEnum('wallet_provider', ['external', 'coinbase_embedded', 'platform_hd'])

export const walletVerificationMethod = pgEnum('wallet_verification_method', [
  'message_signature',
  'micro_deposit',
  'manual',
])

export const depositStatus = pgEnum('deposit_status', [
  'submitted',
  'kyc_pending',
  'kyc_approved',
  'kyc_rejected',
  'awaiting_fiat',
  'fiat_confirmed',
  'bank_approved',
  'platform_approved',
  'mint_pending',
  'mint_requires_safe',
  'mint_processing',
  'minted',
  'mint_failed',
  'rejected',
  'cancelled',
])

export const approvalType = pgEnum('approval_type', ['bank', 'platform'])

export const approvalDecision = pgEnum('approval_decision', ['approved', 'rejected'])

// 'selcom' requires drizzle/0061_selcom_provider.sql applied manually before
// any code writes it — all Selcom paths are env-gated off until then.
export const pspProvider = pgEnum('psp_provider', ['bank_transfer', 'zenopay', 'snippe', 'snippe_card', 'azampay', 'selcom'])

export const transferStatus = pgEnum('transfer_status', ['pending', 'submitted', 'completed', 'failed'])

export const transferToken = pgEnum('transfer_token', ['ntzs', 'usdc', 'usdt'])

export const webhookEventStatus = pgEnum('webhook_event_status', ['pending', 'delivered', 'failed'])

export const burnStatus = pgEnum('burn_status', [
  'requested',
  'approved',
  'requires_second_approval',
  'rejected',
  'burn_submitted',
  'burned',
  'failed',
])

export const enforcementActionType = pgEnum('enforcement_action_type', [
  'freeze',
  'unfreeze',
  'blacklist',
  'unblacklist',
  'wipe_blacklisted',
])

export const banks = pgTable(
  'banks',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    status: text('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    nameIdx: uniqueIndex('banks_name_uq').on(t.name),
  })
)

export const users = pgTable(
  'users',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    // Map this to Neon Auth user id when we integrate (store as string/uuid depending on what Neon Auth returns).
    neonAuthUserId: text('neon_auth_user_id').notNull(),

    email: varchar('email', { length: 320 }).notNull(),
    name: text('name'),
    phone: varchar('phone', { length: 32 }),
    payAlias: varchar('pay_alias', { length: 40 }),

    role: userRole('role').notNull().default('end_user'),
    bankId: uuid('bank_id').references(() => banks.id),
    fundManagerId: uuid('fund_manager_id').references(() => fundManagers.id, { onDelete: 'set null' }),

    isActive: boolean('is_active').notNull().default(true),

    productAccess: text('product_access').array().notNull().default(sql`ARRAY['consumer']::text[]`),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    neonAuthUserIdUq: uniqueIndex('users_neon_auth_user_id_uq').on(t.neonAuthUserId),
    payAliasUq: uniqueIndex('users_pay_alias_uq').on(t.payAlias),
    bankIdx: index('users_bank_id_idx').on(t.bankId),
    roleIdx: index('users_role_idx').on(t.role),
    productAccessIdx: index('users_product_access_idx').on(t.productAccess),
  })
)

export const kycCases = pgTable(
  'kyc_cases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Nullable since 0063: an async document-verification case opens before
    // any ID number is known (it arrives extracted on the result webhook).
    nationalId: text('national_id'),
    status: kycStatus('status').notNull().default('pending'),

    provider: text('provider').notNull().default('manual'),
    providerReference: text('provider_reference'),
    /** ISO 3166-1 alpha-2 of the identity claim. Pre-international rows are TZ by construction. */
    country: text('country').notNull().default('TZ'),
    /** Document/ID type backing the case (SmileID vocabulary, e.g. IDENTITY_CARD, PASSPORT). NULL on legacy NIDA cases. */
    idType: text('id_type'),
    /** SmileID user handle echoed on result webhooks — fallback correlation key (provider_reference holds the job_id). */
    providerUserId: text('provider_user_id'),

    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewReason: text('review_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('kyc_cases_user_id_idx').on(t.userId),
    statusIdx: index('kyc_cases_status_idx').on(t.status),
    providerReferenceIdx: index('kyc_cases_provider_reference_idx').on(t.providerReference),
  })
)

export const kycDocuments = pgTable(
  'kyc_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    kycCaseId: uuid('kyc_case_id')
      .notNull()
      .references(() => kycCases.id, { onDelete: 'cascade' }),

    docType: text('doc_type').notNull(),
    s3Key: text('s3_key').notNull(),
    contentType: text('content_type'),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    caseIdx: index('kyc_documents_kyc_case_id_idx').on(t.kycCaseId),
  })
)

export const wallets = pgTable(
  'wallets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    chain: chain('chain').notNull(),
    address: text('address').notNull(),

    provider: walletProvider('provider').notNull().default('external'),
    providerUserRef: text('provider_user_ref'),
    providerWalletRef: text('provider_wallet_ref'),

    frozen: boolean('frozen').notNull().default(false),

    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    verificationMethod: walletVerificationMethod('verification_method'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('wallets_user_id_idx').on(t.userId),
    chainAddressUq: uniqueIndex('wallets_chain_address_uq').on(t.chain, t.address),
  })
)

export const enforcementActions = pgTable(
  'enforcement_actions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    actionType: enforcementActionType('action_type').notNull(),

    chain: chain('chain').notNull(),
    contractAddress: text('contract_address').notNull(),

    targetAddress: text('target_address').notNull(),
    txHash: text('tx_hash').notNull(),

    reason: text('reason').notNull(),

    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    txHashUq: uniqueIndex('enforcement_actions_tx_hash_uq').on(t.txHash),
    chainIdx: index('enforcement_actions_chain_idx').on(t.chain),
    actionIdx: index('enforcement_actions_action_type_idx').on(t.actionType),
    targetIdx: index('enforcement_actions_target_address_idx').on(t.targetAddress),
  })
)

export const burnRequests = pgTable(
  'burn_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'restrict' }),

    chain: chain('chain').notNull(),
    contractAddress: text('contract_address').notNull(),

    amountTzs: bigint('amount_tzs', { mode: 'number' }).notNull(),
    reason: text('reason').notNull(),

    status: burnStatus('status').notNull().default('requested'),

    requestedByUserId: uuid('requested_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    approvedByUserId: uuid('approved_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    approvedAt: timestamp('approved_at', { withTimezone: true }),

    secondApprovedByUserId: uuid('second_approved_by_user_id').references(() => users.id, { onDelete: 'restrict' }),
    secondApprovedAt: timestamp('second_approved_at', { withTimezone: true }),

    txHash: text('tx_hash'),
    error: text('error'),

    // Payout fields for off-ramp (added for WaaS)
    recipientPhone: varchar('recipient_phone', { length: 32 }),
    payoutReference: text('payout_reference'),
    payoutStatus: text('payout_status'),
    payoutError: text('payout_error'),
    platformFeeTzs: bigint('platform_fee_tzs', { mode: 'number' }),
    // On-chain tx hash for the mint-to-treasury of the platform fee (nullable: legacy / zero-fee rows)
    feeTxHash: text('fee_tx_hash'),
    feeRecipientAddress: text('fee_recipient_address'),
    // Ramp corridor: NEDA's protocol cut, split out of the platform fee and minted
    // to the platform treasury. (platform_fee_tzs then holds the partner's share.)
    nedaFeeTzs: bigint('neda_fee_tzs', { mode: 'number' }),
    nedaFeeTxHash: text('neda_fee_tx_hash'),
    // Explicit on-chain address to burn from (overrides wallet_id lookup).
    // Set for merchant financing disbursements → the lender's treasury wallet,
    // and for agent-float disbursements → the funding sub-wallet.
    burnFromAddress: text('burn_from_address'),

    /**
     * Funding sub-wallet for agent-float ("SmartWakala") disbursements
     * (drizzle/0068). NULL for every user-funded burn.
     *
     * ⚠ This is the CAP SUBJECT, not decoration. Sub-wallets sit under a
     * partner treasury and so escape the per-user sandbox limits by default;
     * tagging the burn is what lets BoT Parameters #4/#5 be counted per agent
     * float, so a float is capped exactly as a user is. Never disburse from a
     * sub-wallet without setting this.
     */
    subWalletId: uuid('sub_wallet_id'),

    // Rail that carries (or carried) the fiat leg (drizzle/0061 — applied).
    payoutProvider: pspProvider('payout_provider'),
    // PSP charge funded from the reserve for this payout (drizzle/0061).
    pspFeeTzs: bigint('psp_fee_tzs', { mode: 'number' }),

    // What the fiat leg pays (drizzle/0064): 'wallet' = mobile-money payout
    // (classic withdrawal), 'lipa' = merchant till, 'bill' = biller payment.
    payoutKind: text('payout_kind').notNull().default('wallet'),
    // Spend-target descriptor + disclosure snapshot for lipa/bill rows
    // (drizzle/0064): { kind, payNumber?, network?, utilityCode?, utilityRef?,
    // recipientName?, principalTzs, selcomFeeEstimateTzs, actualChargesTzs?,
    // selcomReceipt? }.
    spend: jsonb('spend'),

    // Links this burn to a Ramp API settlement (off-ramp leg), so PSP webhooks
    // can resume the ramp flow. Plain uuid (app-level link to ramp_settlements).
    rampSettlementId: uuid('ramp_settlement_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('burn_requests_user_id_idx').on(t.userId),
    walletIdx: index('burn_requests_wallet_id_idx').on(t.walletId),
    statusIdx: index('burn_requests_status_idx').on(t.status),
    txHashIdx: index('burn_requests_tx_hash_idx').on(t.txHash),
  })
)

export const depositRequests = pgTable(
  'deposit_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    bankId: uuid('bank_id')
      .notNull()
      .references(() => banks.id, { onDelete: 'restrict' }),

    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'restrict' }),

    chain: chain('chain').notNull(),

    amountTzs: bigint('amount_tzs', { mode: 'number' }).notNull(),

    status: depositStatus('status').notNull().default('submitted'),

    // Idempotency key required on create; scope in application as (userId, key) or (bankId, key)
    idempotencyKey: text('idempotency_key').notNull(),

    fiatConfirmedByUserId: uuid('fiat_confirmed_by_user_id').references(() => users.id),
    fiatConfirmedAt: timestamp('fiat_confirmed_at', { withTimezone: true }),
    mintedAt: timestamp('minted_at', { withTimezone: true }),

    // WaaS partner reference (nullable — only set for deposits via WaaS API)
    partnerId: uuid('partner_id').references(() => partners.id),

    // PSP integration fields
    paymentProvider: pspProvider('payment_provider').default('bank_transfer'),
    pspReference: text('psp_reference'), // ZenoPay transid or bank reference
    pspChannel: text('psp_channel'), // e.g., 'MPESA-TZ', 'TIGOPESA-TZ'
    buyerPhone: varchar('buyer_phone', { length: 32 }), // Phone used for M-Pesa payment

    // 'self' = user's own deposit, 'pay_link' = collection via Pay Me link,
    // 'ramp' = collected for a Ramp API on-ramp settlement.
    source: text('source').notNull().default('self'),
    payerName: text('payer_name'),

    // Links this deposit to a Ramp API settlement (on-ramp leg) so the PSP
    // payment webhook can resume the ramp flow after mint.
    rampSettlementId: uuid('ramp_settlement_id'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('deposit_requests_user_id_idx').on(t.userId),
    bankIdx: index('deposit_requests_bank_id_idx').on(t.bankId),
    statusIdx: index('deposit_requests_status_idx').on(t.status),
    idempotencyUq: uniqueIndex('deposit_requests_user_idempotency_uq').on(t.userId, t.idempotencyKey),
    pspRefIdx: index('deposit_requests_psp_reference_idx').on(t.pspReference),
  })
)

export const depositApprovals = pgTable(
  'deposit_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    depositRequestId: uuid('deposit_request_id')
      .notNull()
      .references(() => depositRequests.id, { onDelete: 'cascade' }),

    approverUserId: uuid('approver_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    approvalType: approvalType('approval_type').notNull(),
    decision: approvalDecision('decision').notNull(),
    reason: text('reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestIdx: index('deposit_approvals_deposit_request_id_idx').on(t.depositRequestId),
    typeIdx: index('deposit_approvals_type_idx').on(t.approvalType),
    // Prevent multiple approvals of same type on same request
    typeUq: uniqueIndex('deposit_approvals_request_type_uq').on(t.depositRequestId, t.approvalType),
  })
)

// PSP payments that arrived with no deposit_request_id in the webhook metadata
// (e.g. a customer paying the Snippe collection till directly instead of
// completing the in-app checkout). The money is at the PSP but unattributed;
// rows are parked here for backstage review instead of being dropped, and an
// admin attaches each to exactly one 'submitted' deposit before minting.
export const orphanPayments = pgTable(
  'orphan_payments',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    provider: text('provider').notNull().default('snippe'),
    // PSP transaction reference — unique so webhook redeliveries can't park twice.
    pspReference: text('psp_reference').notNull(),
    eventType: text('event_type'),

    amountTzs: bigint('amount_tzs', { mode: 'number' }).notNull(),
    currency: text('currency').notNull().default('TZS'),

    payerPhone: varchar('payer_phone', { length: 32 }),
    payerName: text('payer_name'),
    channel: text('channel'),

    // 'unmatched' | 'matched' | 'dismissed'
    status: text('status').notNull().default('unmatched'),

    matchedDepositRequestId: uuid('matched_deposit_request_id').references(() => depositRequests.id),
    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    notes: text('notes'),

    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pspRefUq: uniqueIndex('orphan_payments_psp_reference_uq').on(t.provider, t.pspReference),
    statusIdx: index('orphan_payments_status_idx').on(t.status),
  })
)

export const mintTransactions = pgTable(
  'mint_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    depositRequestId: uuid('deposit_request_id')
      .notNull()
      .references(() => depositRequests.id, { onDelete: 'cascade' }),

    chain: chain('chain').notNull(),
    contractAddress: text('contract_address').notNull(),
    txHash: text('tx_hash'),

    status: text('status').notNull().default('created'),
    error: text('error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    requestUq: uniqueIndex('mint_transactions_deposit_request_uq').on(t.depositRequestId),
    txHashIdx: index('mint_transactions_tx_hash_idx').on(t.txHash),
  })
)

export const dailyIssuance = pgTable(
  'daily_issuance',
  {
    // YYYY-MM-DD in UTC
    day: text('day').primaryKey(),

    // cap/reservations are stored in TZS (integer)
    capTzs: bigint('cap_tzs', { mode: 'number' }).notNull(),

    reservedTzs: bigint('reserved_tzs', { mode: 'number' }).notNull().default(0),
    issuedTzs: bigint('issued_tzs', { mode: 'number' }).notNull().default(0),

    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    dayIdx: index('daily_issuance_day_idx').on(t.day),
  })
)

export const auditLogs = pgTable(
  'audit_logs',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    actorUserId: uuid('actor_user_id').references(() => users.id),
    action: text('action').notNull(),

    entityType: text('entity_type'),
    entityId: text('entity_id'),

    metadata: jsonb('metadata'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    actorIdx: index('audit_logs_actor_user_id_idx').on(t.actorUserId),
    actionIdx: index('audit_logs_action_idx').on(t.action),
  })
)

export const reconciliationEntryType = pgEnum('reconciliation_entry_type', [
  'untracked_mint',
  'test_mint',
  'manual_correction',
  'double_mint',
  'opening_balance',
  'other',
])

export const reconciliationEntries = pgTable(
  'reconciliation_entries',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    chain: chain('chain').notNull(),
    txHash: text('tx_hash'),
    toAddress: text('to_address'),
    contractAddress: text('contract_address'),
    amountTzs: bigint('amount_tzs', { mode: 'number' }).notNull(),

    entryType: reconciliationEntryType('entry_type').notNull(),
    reason: text('reason').notNull(),
    notes: text('notes'),

    createdByUserId: uuid('created_by_user_id')
      .notNull()
      .references(() => users.id),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chainIdx: index('reconciliation_entries_chain_idx').on(t.chain),
  })
)

// ─── WaaS Tables ────────────────────────────────────────────────────────────

export const partners = pgTable(
  'partners',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    email: varchar('email', { length: 320 }),
    passwordHash: text('password_hash'),
    apiKeyHash: text('api_key_hash').notNull(),
    apiKeyPrefix: varchar('api_key_prefix', { length: 20 }),
    // Developer TEST MODE (Stripe-style test keys) — 'live' | 'test'.
    // A 'test' partner is a separate row with its own API key whose traffic is
    // served entirely by lib/testmode/: no chain, no PSP, no money tables.
    // NOT related to the BoT regulatory sandbox (lib/sandbox/limits.ts).
    // Requires drizzle/0066_test_mode.sql.
    mode: text('mode').notNull().default('live'),
    /** Set on a test partner: the live partner it was issued for (null on live rows). */
    livePartnerId: uuid('live_partner_id'),
    webhookUrl: text('webhook_url'),
    webhookSecret: text('webhook_secret'),
    // Enabled capability scopes (composable platform model). NULL = legacy
    // partner → resolved to the full set for backward compatibility.
    capabilities: text('capabilities').array(),
    encryptedHdSeed: text('encrypted_hd_seed'),
    nextWalletIndex: integer('next_wallet_index').notNull().default(0),
    nextSubWalletIndex: integer('next_sub_wallet_index').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendReason: text('suspend_reason'),
    dailyLimitTzs: bigint('daily_limit_tzs', { mode: 'number' }),
    contractSignedAt: timestamp('contract_signed_at', { withTimezone: true }),
    // Reliance on this partner for CDD: may they attest a KYC outcome to us
    // (POST /api/v1/users/:id/kyc/attestation) and have it approve the case?
    // OFF until compliance grants it in Backstage — an API key alone must
    // never be able to manufacture a verified identity. Requires 0076.
    kycAttestationEnabled: boolean('kyc_attestation_enabled').notNull().default(false),
    kycAttestationGrantedAt: timestamp('kyc_attestation_granted_at', { withTimezone: true }),
    kycAttestationAgreementRef: text('kyc_attestation_agreement_ref'),
    treasuryWalletAddress: text('treasury_wallet_address'),
    feePercent: numeric('fee_percent').notNull().default('0'),
    payoutPhone: text('payout_phone'),
    payoutType: text('payout_type').default('mobile'),
    payoutBankAccount: text('payout_bank_account'),
    payoutBankName: text('payout_bank_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    // WaaS billing fields
    joiningFeeUsd: numeric('joining_fee_usd', { precision: 12, scale: 2 }).notNull().default('50000'),
    joiningFeePaidAt: timestamp('joining_fee_paid_at', { withTimezone: true }),
    pilotEndsAt: timestamp('pilot_ends_at', { withTimezone: true }),
    walletAllocation: integer('wallet_allocation').notNull().default(20),
    contractEndAt: timestamp('contract_end_at', { withTimezone: true }),
    monthlyFeeUsd: numeric('monthly_fee_usd', { precision: 12, scale: 2 }).notNull().default('2000'),
  },
  (t) => ({
    apiKeyHashUq: uniqueIndex('partners_api_key_hash_uq').on(t.apiKeyHash),
    emailUq: uniqueIndex('partners_email_uq').on(t.email),
    nameIdx: index('partners_name_idx').on(t.name),
  })
)

export const partnerSubWallets = pgTable(
  'partner_sub_wallets',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    label: text('label').notNull(),
    address: text('address').notNull(),
    walletIndex: integer('wallet_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partnerIdx: index('partner_sub_wallets_partner_id_idx').on(t.partnerId),
  })
)

export const partnerUsers = pgTable(
  'partner_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    walletIndex: integer('wallet_index'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partnerExternalUq: uniqueIndex('partner_users_partner_external_uq').on(t.partnerId, t.externalId),
    userIdx: index('partner_users_user_id_idx').on(t.userId),
    partnerIdx: index('partner_users_partner_id_idx').on(t.partnerId),
  })
)

export const transfers = pgTable(
  'transfers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partnerId: uuid('partner_id').references(() => partners.id),
    fromUserId: uuid('from_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    toUserId: uuid('to_user_id')
      .references(() => users.id, { onDelete: 'restrict' }),
    toAddress: text('to_address'),
    token: transferToken('token').notNull().default('ntzs'),
    amountTzs: bigint('amount_tzs', { mode: 'number' }).notNull(),
    txHash: text('tx_hash'),
    status: transferStatus('status').notNull().default('pending'),
    error: text('error'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fromUserIdx: index('transfers_from_user_id_idx').on(t.fromUserId),
    toUserIdx: index('transfers_to_user_id_idx').on(t.toUserId),
    statusIdx: index('transfers_status_idx').on(t.status),
    partnerIdx: index('transfers_partner_id_idx').on(t.partnerId),
    txHashIdx: index('transfers_tx_hash_idx').on(t.txHash),
  })
)

// ─── Savings / Yield Tables ─────────────────────────────────────────────────

export const savingsPositionStatus = pgEnum('savings_position_status', [
  'active',
  'closed',
])

export const savingsTxType = pgEnum('savings_tx_type', [
  'deposit',
  'withdrawal',
  'yield_credit',
])

export const savingsTxStatus = pgEnum('savings_tx_status', [
  'pending',
  'completed',
  'failed',
])

export const fundManagerStatus = pgEnum('fund_manager_status', ['active', 'paused', 'terminated'])

export const savingsProductStatus = pgEnum('savings_product_status', ['active', 'paused', 'closed'])

/**
 * Licensed fund managers that custody and invest deposited TZS.
 * Each manager operates under a separate investment/fund management agreement.
 */
export const fundManagers = pgTable(
  'fund_managers',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    contactEmail: varchar('contact_email', { length: 320 }),
    contactPhone: varchar('contact_phone', { length: 32 }),
    licenseNumber: text('license_number'),
    agreementSignedAt: timestamp('agreement_signed_at', { withTimezone: true }),
    tvlLimitTzs: bigint('tvl_limit_tzs', { mode: 'number' }),
    status: fundManagerStatus('status').notNull().default('active'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('fund_managers_status_idx').on(t.status),
  })
)

/**
 * Savings products offered to users. Each product is backed by a specific fund manager.
 * lockDays = 0 means open-ended (withdraw any time).
 */
export const savingsProducts = pgTable(
  'savings_products',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    fundManagerId: uuid('fund_manager_id')
      .notNull()
      .references(() => fundManagers.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    description: text('description'),
    annualRateBps: integer('annual_rate_bps').notNull(),
    lockDays: integer('lock_days').notNull().default(0),
    minDepositTzs: bigint('min_deposit_tzs', { mode: 'number' }).notNull().default(0),
    maxDepositTzs: bigint('max_deposit_tzs', { mode: 'number' }),
    status: savingsProductStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fundManagerIdx: index('savings_products_fund_manager_id_idx').on(t.fundManagerId),
    statusIdx: index('savings_products_status_idx').on(t.status),
  })
)

/**
 * One savings position per user per product.
 * productId links to the savings product (and transitively to the fund manager).
 * annualRateBps is snapshotted from the product at open time — rate changes
 * on the product do not affect existing positions.
 */
export const savingsPositions = pgTable(
  'savings_positions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    walletId: uuid('wallet_id')
      .notNull()
      .references(() => wallets.id, { onDelete: 'restrict' }),

    productId: uuid('product_id')
      .notNull()
      .references(() => savingsProducts.id, { onDelete: 'restrict' }),

    principalTzs: bigint('principal_tzs', { mode: 'number' }).notNull().default(0),
    accruedYieldTzs: bigint('accrued_yield_tzs', { mode: 'number' }).notNull().default(0),

    totalDepositedTzs: bigint('total_deposited_tzs', { mode: 'number' }).notNull().default(0),
    totalWithdrawnTzs: bigint('total_withdrawn_tzs', { mode: 'number' }).notNull().default(0),
    totalYieldClaimedTzs: bigint('total_yield_claimed_tzs', { mode: 'number' }).notNull().default(0),

    annualRateBps: integer('annual_rate_bps').notNull(),

    status: savingsPositionStatus('status').notNull().default('active'),

    lastAccrualAt: timestamp('last_accrual_at', { withTimezone: true }),
    openedAt: timestamp('opened_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    maturesAt: timestamp('matures_at', { withTimezone: true }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userProductUq: uniqueIndex('savings_positions_user_product_uq').on(t.userId, t.productId),
    statusIdx: index('savings_positions_status_idx').on(t.status),
    productIdx: index('savings_positions_product_id_idx').on(t.productId),
    lastAccrualIdx: index('savings_positions_last_accrual_idx').on(t.lastAccrualAt),
  })
)

/**
 * Every fiat/yield movement in or out of a savings position.
 */
export const savingsTransactions = pgTable(
  'savings_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    positionId: uuid('position_id')
      .notNull()
      .references(() => savingsPositions.id, { onDelete: 'restrict' }),

    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),

    type: savingsTxType('type').notNull(),
    status: savingsTxStatus('status').notNull().default('pending'),

    amountTzs: bigint('amount_tzs', { mode: 'number' }).notNull(),

    pspReference: text('psp_reference'),
    mintTxHash: text('mint_tx_hash'),

    notes: text('notes'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    positionIdx: index('savings_transactions_position_id_idx').on(t.positionId),
    userIdx: index('savings_transactions_user_id_idx').on(t.userId),
    typeIdx: index('savings_transactions_type_idx').on(t.type),
    statusIdx: index('savings_transactions_status_idx').on(t.status),
  })
)

/**
 * Daily yield accrual log — one row per position per day.
 * Provides full audit trail for Justin and compliance.
 */
export const yieldAccruals = pgTable(
  'yield_accruals',
  {
    id: uuid('id').defaultRandom().primaryKey(),

    positionId: uuid('position_id')
      .notNull()
      .references(() => savingsPositions.id, { onDelete: 'restrict' }),

    date: text('date').notNull(),

    principalTzs: bigint('principal_tzs', { mode: 'number' }).notNull(),
    rateBps: integer('rate_bps').notNull(),
    accruedTzs: bigint('accrued_tzs', { mode: 'number' }).notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    positionDateUq: uniqueIndex('yield_accruals_position_date_uq').on(t.positionId, t.date),
    positionIdx: index('yield_accruals_position_id_idx').on(t.positionId),
    dateIdx: index('yield_accruals_date_idx').on(t.date),
  })
)

// ─── SimpleFX LP Tables ──────────────────────────────────────────────────────

export const lpKycStatus = pgEnum('lp_kyc_status', ['pending', 'approved', 'rejected'])
// Onboarding model: account type, lifecycle status, and org-level KYB status.
export const lpAccountType = pgEnum('lp_account_type', ['standard', 'bank'])
export const lpAccountStatus = pgEnum('lp_account_status', ['onboarding', 'active', 'suspended'])
export const lpKybStatus = pgEnum('lp_kyb_status', ['not_started', 'submitted', 'approved', 'rejected'])
export const lpKybDocStatus = pgEnum('lp_kyb_doc_status', ['submitted', 'approved', 'rejected'])
// Maker-checker: org members + roles.
export const lpMemberRole = pgEnum('lp_member_role', ['owner', 'operator', 'approver', 'viewer'])
export const lpMemberStatus = pgEnum('lp_member_status', ['invited', 'active', 'disabled'])
export const lpApprovalStatus = pgEnum('lp_approval_status', ['pending', 'approved', 'rejected'])

export const lpAccounts = pgTable(
  'lp_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    displayName: text('display_name'),

    walletAddress: text('wallet_address').notNull(),
    walletIndex: integer('wallet_index').notNull(),

    bidBps: integer('bid_bps').notNull().default(120),
    askBps: integer('ask_bps').notNull().default(150),
    isActive: boolean('is_active').notNull().default(false),

    onboardingStep: integer('onboarding_step').notNull().default(1),

    kycStatus: lpKycStatus('kyc_status').notNull().default('pending'),

    // Onboarding foundation (additive). `kycStatus` retained for back-compat;
    // `kybStatus` is the org-level KYB state used by the bank onboarding path.
    accountType: lpAccountType('account_type').notNull().default('standard'),
    status: lpAccountStatus('status').notNull().default('onboarding'),
    kybStatus: lpKybStatus('kyb_status').notNull().default('not_started'),
    bankingProfile: jsonb('banking_profile'),
    limits: jsonb('limits'),
    kybReviewNote: text('kyb_review_note'),

    // Time-boxed sandbox test access: while this is in the future the account
    // may use the portal without full KYC/KYB (status is unlocked but kybStatus
    // stays truthful). Auto-reverts on expiry; granted/revoked in backstage.
    testAccessUntil: timestamp('test_access_until', { withTimezone: true }),
    testAccessNote: text('test_access_note'),

    apiKeyHash: text('api_key_hash'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUq: uniqueIndex('lp_accounts_email_uq').on(t.email),
    walletIndexUq: uniqueIndex('lp_accounts_wallet_index_uq').on(t.walletIndex),
    walletAddressUq: uniqueIndex('lp_accounts_wallet_address_uq').on(t.walletAddress),
    kycIdx: index('lp_accounts_kyc_status_idx').on(t.kycStatus),
    apiKeyHashUq: uniqueIndex('lp_accounts_api_key_hash_uq').on(t.apiKeyHash),
  })
)

// KYB documents uploaded during bank onboarding (one row per doc type per LP).
export const lpKybDocuments = pgTable(
  'lp_kyb_documents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lpId: uuid('lp_id')
      .notNull()
      .references(() => lpAccounts.id, { onDelete: 'cascade' }),
    docType: text('doc_type').notNull(),
    fileUrl: text('file_url'), // legacy (Vercel Blob); new uploads use fileData
    fileData: text('file_data'), // base64-encoded file bytes, stored in Postgres
    contentType: text('content_type'),
    fileName: text('file_name'),
    status: lpKybDocStatus('status').notNull().default('submitted'),
    reviewedBy: text('reviewed_by'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lpDocUq: uniqueIndex('lp_kyb_documents_lp_doc_uq').on(t.lpId, t.docType),
    lpIdx: index('lp_kyb_documents_lp_id_idx').on(t.lpId),
  })
)

// Org members (maker-checker). One row per user; an email belongs to one member.
export const lpMembers = pgTable(
  'lp_members',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lpId: uuid('lp_id')
      .notNull()
      .references(() => lpAccounts.id, { onDelete: 'cascade' }),
    email: varchar('email', { length: 320 }).notNull(),
    role: lpMemberRole('role').notNull().default('owner'),
    status: lpMemberStatus('status').notNull().default('active'),
    invitedByMemberId: uuid('invited_by_member_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUq: uniqueIndex('lp_members_email_uq').on(t.email),
    lpIdx: index('lp_members_lp_id_idx').on(t.lpId),
  })
)

// Maker-checker approvals — a maker's gated action waits here for a checker.
export const lpApprovals = pgTable(
  'lp_approvals',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lpId: uuid('lp_id')
      .notNull()
      .references(() => lpAccounts.id, { onDelete: 'cascade' }),
    action: text('action').notNull(), // set_fx | set_banking
    payload: jsonb('payload'),
    requestedByMemberId: uuid('requested_by_member_id'),
    status: lpApprovalStatus('status').notNull().default('pending'),
    decidedByMemberId: uuid('decided_by_member_id'),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lpStatusIdx: index('lp_approvals_lp_status_idx').on(t.lpId, t.status),
  })
)

export const lpOtpCodes = pgTable(
  'lp_otp_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    used: boolean('used').notNull().default(false),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('lp_otp_codes_email_idx').on(t.email),
    expiresIdx: index('lp_otp_codes_expires_at_idx').on(t.expiresAt),
  })
)

export const lpNextWalletIndex = pgTable(
  'lp_next_wallet_index',
  {
    id: integer('id').primaryKey().default(1),
    nextIndex: integer('next_index').notNull().default(0),
  }
)

/**
 * Single-row config table for SimpleFX platform settings.
 * id is always 1. Admin sets midRateTZS (nTZS per 1 USDC).
 */
export const lpFxConfig = pgTable('lp_fx_config', {
  id: integer('id').primaryKey().default(1),
  midRateTZS: integer('mid_rate_tzs').notNull().default(3750),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

/**
 * Supported trading pairs for the SimpleFX liquidity pool.
 * Each row is a pair the bot can trade (e.g. nTZS/USDC, nTZS/USDT).
 * Admin inserts/activates rows to add new pairs.
 */
export const lpFxPairs = pgTable(
  'lp_fx_pairs',
  {
    id: serial('id').primaryKey(),
    chain: chain('chain').notNull().default('base'),
    token1Address: text('token1_address').notNull(),
    token1Symbol: text('token1_symbol').notNull(),
    token1Decimals: integer('token1_decimals').notNull().default(18),
    token2Address: text('token2_address').notNull(),
    token2Symbol: text('token2_symbol').notNull(),
    token2Decimals: integer('token2_decimals').notNull().default(6),
    midRate: numeric('mid_rate', { precision: 36, scale: 18 }).notNull(),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pairUq: uniqueIndex('lp_fx_pairs_chain_tokens_uq').on(t.chain, t.token1Address, t.token2Address),
  })
)

/**
 * Per-LP, per-token position in the solver pool.
 * When an LP activates, their tokens are swept to the solver wallet and
 * recorded here. Earnings from filled orders accumulate in `earned`.
 */
export const lpPoolPositions = pgTable(
  'lp_pool_positions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lpId: uuid('lp_id')
      .notNull()
      .references(() => lpAccounts.id, { onDelete: 'cascade' }),
    chain: chain('chain').notNull().default('base'),
    tokenAddress: text('token_address').notNull(),
    tokenSymbol: text('token_symbol').notNull(),
    decimals: integer('decimals').notNull().default(18),
    contributed: numeric('contributed', { precision: 36, scale: 18 }).notNull().default('0'),
    earned: numeric('earned', { precision: 36, scale: 18 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lpTokenUq: uniqueIndex('lp_pool_positions_lp_chain_token_uq').on(t.lpId, t.chain, t.tokenAddress),
    lpIdx: index('lp_pool_positions_lp_id_idx').on(t.lpId),
    tokenIdx: index('lp_pool_positions_token_address_idx').on(t.tokenAddress),
  })
)

/**
 * Individual fill records for the SimpleFX LP portal Positions page.
 * Written on every successful direct swap from the solver pool.
 */
export const lpFills = pgTable(
  'lp_fills',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lpId: uuid('lp_id')
      .notNull()
      .references(() => lpAccounts.id, { onDelete: 'cascade' }),
    chain: chain('chain').notNull().default('base'),
    userAddress: text('user_address').notNull(),
    fromToken: text('from_token').notNull(),
    toToken: text('to_token').notNull(),
    amountIn: numeric('amount_in', { precision: 36, scale: 18 }).notNull(),
    amountOut: numeric('amount_out', { precision: 36, scale: 18 }).notNull(),
    spreadEarned: numeric('spread_earned', { precision: 36, scale: 18 }).notNull().default('0'),
    protocolFeeEarned: numeric('protocol_fee_earned', { precision: 36, scale: 18 }).notNull().default('0'),
    inTxHash: text('in_tx_hash').notNull(),
    outTxHash: text('out_tx_hash').notNull(),
    source: text('source'),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lpIdx: index('lp_fills_lp_id_idx').on(t.lpId),
    createdIdx: index('lp_fills_created_at_idx').on(t.createdAt),
    userAddrIdx: index('lp_fills_user_address_idx').on(t.userAddress),
  })
)

/**
 * Audit log of automated protocol fee sweeps from the solver wallet to treasury.
 * Each row = one on-chain transfer per token. The cron job uses SUM(amount) here
 * vs SUM(protocol_fee_earned) in lp_fills to determine the pending balance.
 */
export const fxFeeSweeps = pgTable(
  'fx_fee_sweeps',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    chain: chain('chain').notNull().default('base'),
    tokenAddress: text('token_address').notNull(),
    tokenSymbol: text('token_symbol').notNull(),
    amount: numeric('amount', { precision: 36, scale: 18 }).notNull(),
    txHash: text('tx_hash').notNull(),
    treasuryAddress: text('treasury_address').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    chainTokenIdx: index('fx_fee_sweeps_chain_token_idx').on(t.chain, t.tokenAddress),
    createdAtIdx: index('fx_fee_sweeps_created_at_idx').on(t.createdAt),
  })
)

/**
 * Records every deposit, withdrawal, activation sweep, and deactivation return
 * for an LP wallet so admins and LPs can see a full transaction history.
 */
export const lpWalletTransactions = pgTable(
  'lp_wallet_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    lpId: uuid('lp_id')
      .notNull()
      .references(() => lpAccounts.id, { onDelete: 'cascade' }),
    chain: chain('chain').notNull().default('base'),
    // 'deposit' | 'withdrawal' | 'activation_sweep' | 'deactivation_return'
    type: text('type').notNull(),
    // 'mpesa' | 'onchain' | 'system'
    source: text('source').notNull().default('onchain'),
    tokenAddress: text('token_address').notNull(),
    tokenSymbol: text('token_symbol').notNull(),
    decimals: integer('decimals').notNull().default(18),
    amount: numeric('amount', { precision: 36, scale: 18 }).notNull(),
    // null for mpesa deposits before the mint tx is broadcast
    txHash: text('tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lpIdx: index('lp_wallet_transactions_lp_id_idx').on(t.lpId),
    typeIdx: index('lp_wallet_transactions_type_idx').on(t.type),
    createdIdx: index('lp_wallet_transactions_created_at_idx').on(t.createdAt),
  })
)

/**
 * Tiny KV store for the solver-pool reconciliation cron (fx-pool-reconcile).
 * Keys: 'sweep_cursor:<chain>' (last block scanned by the Transfer-log sweep),
 * 'last_run' (latest run summary, surfaced on backstage/simplefx),
 * 'last_alert' (fingerprint + timestamp for alert dedup).
 */
export const fxReconState = pgTable('fx_recon_state', {
  key: text('key').primaryKey(),
  value: jsonb('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

export const partnerWebhookEvents = pgTable(
  'partner_webhook_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    payload: jsonb('payload').notNull(),
    status: webhookEventStatus('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at', { withTimezone: true }),
    nextRetryAt: timestamp('next_retry_at', { withTimezone: true }),
    responseStatus: integer('response_status'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partnerIdx: index('partner_webhook_events_partner_id_idx').on(t.partnerId),
    statusIdx: index('partner_webhook_events_status_idx').on(t.status),
    nextRetryIdx: index('partner_webhook_events_next_retry_idx').on(t.nextRetryAt),
  })
)

// ─── Merchant Portal Tables ──────────────────────────────────────────────────

export const merchantPaymentLinkType = pgEnum('merchant_payment_link_type', ['fixed', 'open'])

export const merchantCollectionStatus = pgEnum('merchant_collection_status', [
  'pending',
  'minted',
  'failed',
])

export const merchantSettlementStatus = pgEnum('merchant_settlement_status', [
  'pending',
  'queued',
  'processing',
  'completed',
  'failed',
  'skipped',
])

export const merchantAccounts = pgTable(
  'merchant_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    businessName: text('business_name'),
    handle: varchar('handle', { length: 40 }).notNull(),

    walletAddress: text('wallet_address').notNull(),
    walletIndex: integer('wallet_index').notNull(),

    settlePct: integer('settle_pct').notNull().default(0),
    settlementPhone: varchar('settlement_phone', { length: 32 }),
    settlementPendingTzs: bigint('settlement_pending_tzs', { mode: 'number' }).notNull().default(0),

    lenderPartnerId: uuid('lender_partner_id').references(() => partners.id, { onDelete: 'set null' }),
    lenderSplitPct: integer('lender_split_pct').notNull().default(0),
    lenderPendingTzs: bigint('lender_pending_tzs', { mode: 'number' }).notNull().default(0),
    lenderControlsSettlement: boolean('lender_controls_settlement').notNull().default(false),
    withdrawalLimitTzs: bigint('withdrawal_limit_tzs', { mode: 'number' }).notNull().default(0),

    passwordHash: text('password_hash'),

    isActive: boolean('is_active').notNull().default(true),
    onboardingStep: integer('onboarding_step').notNull().default(1),

    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),

    /**
     * Owning partner (drizzle/0067). NULL = first-party merchant (NEDApay /
     * our own portal) — every row that existed before partner scoping, and
     * still the default. A partner API key may only ever see rows matching
     * its own id, so NULL is invisible to partners and fails safe.
     */
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    // email is the merchant-portal login identity: unique among first-party
    // merchants (exactly the old global guarantee, since every legacy row is
    // NULL), and unique per partner for everyone else. The same person may be
    // a merchant on two platforms.
    emailFirstPartyUq: uniqueIndex('merchant_accounts_email_first_party_uq')
      .on(t.email)
      .where(sql`${t.partnerId} is null`),
    emailPartnerUq: uniqueIndex('merchant_accounts_email_partner_uq')
      .on(t.partnerId, t.email)
      .where(sql`${t.partnerId} is not null`),
    // handle stays GLOBALLY unique — it resolves public payment URLs with no
    // tenant context, so a duplicate could route money to the wrong merchant.
    handleUq: uniqueIndex('merchant_accounts_handle_uq').on(t.handle),
    walletIndexUq: uniqueIndex('merchant_accounts_wallet_index_uq').on(t.walletIndex),
    walletAddressUq: uniqueIndex('merchant_accounts_wallet_address_uq').on(t.walletAddress),
    userIdx: index('merchant_accounts_user_id_idx').on(t.userId),
    partnerIdx: index('merchant_accounts_partner_id_idx').on(t.partnerId),
  })
)

export const merchantOtpCodes = pgTable(
  'merchant_otp_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    used: boolean('used').notNull().default(false),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('merchant_otp_codes_email_idx').on(t.email),
    expiresIdx: index('merchant_otp_codes_expires_at_idx').on(t.expiresAt),
  })
)

export const merchantNextWalletIndex = pgTable('merchant_next_wallet_index', {
  id: integer('id').primaryKey().default(1),
  nextIndex: integer('next_index').notNull().default(0),
})

export const merchantAiUsage = pgTable(
  'merchant_ai_usage',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    merchantId: uuid('merchant_id').notNull().references(() => merchantAccounts.id, { onDelete: 'cascade' }),
    period: varchar('period', { length: 7 }).notNull(), // 'YYYY-MM'
    requestCount: integer('request_count').notNull().default(0),
    freeRequestCount: integer('free_request_count').notNull().default(0),
    paidRequestCount: integer('paid_request_count').notNull().default(0),
    totalTokens: integer('total_tokens').notNull().default(0),
    totalFeeTzs: bigint('total_fee_tzs', { mode: 'number' }).notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantPeriodUq: uniqueIndex('merchant_ai_usage_merchant_period_uq').on(t.merchantId, t.period),
    merchantIdx: index('merchant_ai_usage_merchant_id_idx').on(t.merchantId),
    periodIdx: index('merchant_ai_usage_period_idx').on(t.period),
  })
)

export const merchantPlatformFees = pgTable(
  'merchant_platform_fees',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    merchantId: uuid('merchant_id').notNull().references(() => merchantAccounts.id, { onDelete: 'cascade' }),
    amountTzs: bigint('amount_tzs', { mode: 'number' }).notNull(),
    reason: varchar('reason', { length: 50 }).notNull().default('ai_chat'),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantIdx: index('merchant_platform_fees_merchant_id_idx').on(t.merchantId),
    createdAtIdx: index('merchant_platform_fees_created_at_idx').on(t.createdAt),
  })
)

export const merchantPaymentLinks = pgTable(
  'merchant_payment_links',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchantAccounts.id, { onDelete: 'cascade' }),
    type: merchantPaymentLinkType('type').notNull().default('open'),
    productName: text('product_name'),
    imageUrl: text('image_url'),
    amountTzs: bigint('amount_tzs', { mode: 'number' }),
    originalAmountTzs: bigint('original_amount_tzs', { mode: 'number' }),
    discountPct: integer('discount_pct').notNull().default(0),
    description: text('description'),
    promoUrl: text('promo_url'),
    slug: varchar('slug', { length: 60 }),
    isActive: boolean('is_active').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantIdx: index('merchant_payment_links_merchant_id_idx').on(t.merchantId),
    slugUq: uniqueIndex('merchant_payment_links_slug_uq').on(t.slug),
  })
)

export const merchantCollections = pgTable(
  'merchant_collections',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchantAccounts.id, { onDelete: 'restrict' }),
    depositRequestId: uuid('deposit_request_id').notNull(),
    paymentLinkId: uuid('payment_link_id').references(() => merchantPaymentLinks.id),

    amountTzs: bigint('amount_tzs', { mode: 'number' }).notNull(),
    payerPhone: varchar('payer_phone', { length: 32 }),
    payerName: text('payer_name'),

    collectionStatus: merchantCollectionStatus('collection_status').notNull().default('pending'),

    settlePct: integer('settle_pct').notNull().default(0),
    settlementAmountTzs: bigint('settlement_amount_tzs', { mode: 'number' }),
    settlementStatus: merchantSettlementStatus('settlement_status').notNull().default('skipped'),
    settlementBurnRequestId: uuid('settlement_burn_request_id'),

    lenderPct: integer('lender_pct').notNull().default(0),
    lenderAmountTzs: bigint('lender_amount_tzs', { mode: 'number' }),
    lenderSettlementStatus: merchantSettlementStatus('lender_settlement_status').notNull().default('skipped'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    merchantIdx: index('merchant_collections_merchant_id_idx').on(t.merchantId),
    depositRequestUq: uniqueIndex('merchant_collections_deposit_request_uq').on(t.depositRequestId),
    collectionStatusIdx: index('merchant_collections_collection_status_idx').on(t.collectionStatus),
    settlementStatusIdx: index('merchant_collections_settlement_status_idx').on(t.settlementStatus),
    createdIdx: index('merchant_collections_created_at_idx').on(t.createdAt),
  })
)

// ─── Enterprise ──────────────────────────────────────────────────────────────

export const enterpriseAccountType = pgEnum('enterprise_account_type', [
  'capital_lender',
  'disbursement_client',
])

export const enterpriseLoanStatus = pgEnum('enterprise_loan_status', [
  'active',
  'repaid',
  'terminated',
])

export const enterpriseDisbursementBatchStatus = pgEnum('enterprise_disbursement_batch_status', [
  'pending_review',
  'awaiting_funds',
  'approved',
  'processing',
  'completed',
  'failed',
])

export const enterpriseDisbursementRowStatus = pgEnum('enterprise_disbursement_row_status', [
  'pending',
  'processing',
  'completed',
  'failed',
])

export const enterpriseAccounts = pgTable(
  'enterprise_accounts',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    email: varchar('email', { length: 320 }).notNull(),
    phone: varchar('phone', { length: 32 }),
    type: enterpriseAccountType('type').notNull(),
    partnerId: uuid('partner_id').references(() => partners.id, { onDelete: 'set null' }),
    passwordHash: text('password_hash'),
    isActive: boolean('is_active').notNull().default(false),

    linkedAdminUserId: uuid('linked_admin_user_id').references(() => users.id, { onDelete: 'set null' }),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUq: uniqueIndex('enterprise_accounts_email_uq').on(t.email),
    partnerIdx: index('enterprise_accounts_partner_id_idx').on(t.partnerId),
    linkedAdminUserIdx: index('enterprise_accounts_linked_admin_user_id_idx').on(t.linkedAdminUserId),
  })
)

export const enterpriseOtpCodes = pgTable(
  'enterprise_otp_codes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    email: varchar('email', { length: 320 }).notNull(),
    codeHash: text('code_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    used: boolean('used').notNull().default(false),
    attempts: integer('attempts').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailIdx: index('enterprise_otp_codes_email_idx').on(t.email),
    expiresIdx: index('enterprise_otp_codes_expires_at_idx').on(t.expiresAt),
  })
)

export const enterpriseInviteTokens = pgTable(
  'enterprise_invite_tokens',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    enterpriseId: uuid('enterprise_id')
      .notNull()
      .references(() => enterpriseAccounts.id, { onDelete: 'cascade' }),
    tokenHash: text('token_hash').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    usedAt: timestamp('used_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    tokenHashUq: uniqueIndex('enterprise_invite_tokens_token_hash_uq').on(t.tokenHash),
    enterpriseIdx: index('enterprise_invite_tokens_enterprise_id_idx').on(t.enterpriseId),
  })
)

export const enterpriseLoanAgreements = pgTable(
  'enterprise_loan_agreements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchantAccounts.id, { onDelete: 'restrict' }),
    principalTzs: bigint('principal_tzs', { mode: 'number' }).notNull(),
    interestRatePct: integer('interest_rate_pct').notNull().default(0),
    interestTzs: bigint('interest_tzs', { mode: 'number' }).notNull().default(0),
    totalOwedTzs: bigint('total_owed_tzs', { mode: 'number' }).notNull().default(0),
    repaidTzs: bigint('repaid_tzs', { mode: 'number' }).notNull().default(0),
    // Cumulative principal drawn down via merchant financing withdrawals.
    // Revolving facility: available to draw = principal_tzs - (disbursed_tzs - repaid_tzs).
    disbursedTzs: bigint('disbursed_tzs', { mode: 'number' }).notNull().default(0),
    // Loan term for aging/overdue analytics. termDays is the agreed duration;
    // dueAt is the repayment deadline (set when a term is configured).
    termDays: integer('term_days'),
    dueAt: timestamp('due_at', { withTimezone: true }),
    status: enterpriseLoanStatus('status').notNull().default('active'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partnerIdx: index('enterprise_loan_agreements_partner_id_idx').on(t.partnerId),
    merchantIdx: index('enterprise_loan_agreements_merchant_id_idx').on(t.merchantId),
    statusIdx: index('enterprise_loan_agreements_status_idx').on(t.status),
  })
)

export const enterpriseDisbursementBatches = pgTable(
  'enterprise_disbursement_batches',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    enterpriseId: uuid('enterprise_id')
      .notNull()
      .references(() => enterpriseAccounts.id, { onDelete: 'restrict' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    filename: text('filename'),
    totalAmountTzs: bigint('total_amount_tzs', { mode: 'number' }).notNull(),
    serviceFeeTzs: bigint('service_fee_tzs', { mode: 'number' }).notNull(),
    contractorCount: integer('contractor_count').notNull(),
    status: enterpriseDisbursementBatchStatus('status').notNull().default('pending_review'),
    bankReference: text('bank_reference'),
    bankReceivedAt: timestamp('bank_received_at', { withTimezone: true }),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    enterpriseIdx: index('enterprise_disbursement_batches_enterprise_id_idx').on(t.enterpriseId),
    statusIdx: index('enterprise_disbursement_batches_status_idx').on(t.status),
    createdIdx: index('enterprise_disbursement_batches_created_at_idx').on(t.createdAt),
  })
)

export const enterpriseDisbursementRows = pgTable(
  'enterprise_disbursement_rows',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    batchId: uuid('batch_id')
      .notNull()
      .references(() => enterpriseDisbursementBatches.id, { onDelete: 'cascade' }),
    contractorName: text('contractor_name').notNull(),
    phone: varchar('phone', { length: 32 }).notNull(),
    amountTzs: bigint('amount_tzs', { mode: 'number' }).notNull(),
    payoutMethod: text('payout_method').notNull().default('mobile'),
    bankAccount: text('bank_account'),
    status: enterpriseDisbursementRowStatus('status').notNull().default('pending'),
    payoutReference: text('payout_reference'),
    payoutError: text('payout_error'),
    burnRequestId: uuid('burn_request_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    batchIdx: index('enterprise_disbursement_rows_batch_id_idx').on(t.batchId),
    statusIdx: index('enterprise_disbursement_rows_status_idx').on(t.status),
  })
)

export const enterpriseMerchantApplications = pgTable(
  'enterprise_merchant_applications',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    enterpriseId: uuid('enterprise_id')
      .notNull()
      .references(() => enterpriseAccounts.id, { onDelete: 'cascade' }),
    merchantId: uuid('merchant_id')
      .notNull()
      .references(() => merchantAccounts.id, { onDelete: 'cascade' }),
    direction: text('direction').notNull(), // 'invite' | 'application'
    status: text('status').notNull().default('pending'), // pending | accepted | rejected | cancelled
    proposedSplitPct: integer('proposed_split_pct'),
    message: text('message'),
    respondedAt: timestamp('responded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    enterpriseIdx: index('enterprise_merchant_applications_enterprise_id_idx').on(t.enterpriseId),
    merchantIdx: index('enterprise_merchant_applications_merchant_id_idx').on(t.merchantId),
    statusIdx: index('enterprise_merchant_applications_status_idx').on(t.status),
  })
)

export const enterpriseWithdrawRequests = pgTable(
  'enterprise_withdraw_requests',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    enterpriseId: uuid('enterprise_id')
      .notNull()
      .references(() => enterpriseAccounts.id, { onDelete: 'cascade' }),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'restrict' }),
    amountTzs: bigint('amount_tzs', { mode: 'number' }).notNull(),
    payoutMethod: text('payout_method').notNull().default('mobile'),
    payoutPhone: varchar('payout_phone', { length: 32 }),
    payoutBankAccount: text('payout_bank_account'),
    status: text('status').notNull().default('pending'),
    notes: text('notes'),
    processedAt: timestamp('processed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    enterpriseIdx: index('enterprise_withdraw_requests_enterprise_id_idx').on(t.enterpriseId),
    statusIdx: index('enterprise_withdraw_requests_status_idx').on(t.status),
    createdAtIdx: index('enterprise_withdraw_requests_created_at_idx').on(t.createdAt),
  })
)

export const partnerInvoiceType = pgEnum('partner_invoice_type', [
  'joining_fee',
  'saas_monthly',
  'transaction_fees',
])

export const partnerInvoiceStatus = pgEnum('partner_invoice_status', [
  'pending',
  'paid',
  'void',
  'overdue',
])

export const partnerInvoices = pgTable(
  'partner_invoices',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    type: partnerInvoiceType('type').notNull(),
    amountUsd: numeric('amount_usd', { precision: 12, scale: 2 }).notNull(),
    status: partnerInvoiceStatus('status').notNull().default('pending'),
    periodStart: timestamp('period_start', { withTimezone: true }),
    periodEnd: timestamp('period_end', { withTimezone: true }),
    dueAt: timestamp('due_at', { withTimezone: true }),
    paidAt: timestamp('paid_at', { withTimezone: true }),
    paymentMethod: text('payment_method'), // 'bank_transfer' | 'usdc'
    paymentRef: text('payment_ref'),
    lateInterestUsd: numeric('late_interest_usd', { precision: 12, scale: 2 }).notNull().default('0'),
    notes: text('notes'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partnerIdx: index('partner_invoices_partner_id_idx').on(t.partnerId),
    statusIdx: index('partner_invoices_status_idx').on(t.status),
    dueAtIdx: index('partner_invoices_due_at_idx').on(t.dueAt),
  })
)

export const partnerKybStatus = pgEnum('partner_kyb_status', [
  'not_started',
  'submitted',
  'under_review',
  'approved',
  'rejected',
])

export const partnerKyb = pgTable(
  'partner_kyb',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partnerId: uuid('partner_id')
      .notNull()
      .unique()
      .references(() => partners.id, { onDelete: 'cascade' }),
    status: partnerKybStatus('status').notNull().default('not_started'),
    // Business details
    businessLegalName: text('business_legal_name'),
    registrationNumber: text('registration_number'),
    registeredAddress: text('registered_address'),
    authorizedRepName: text('authorized_rep_name'),
    authorizedRepTitle: text('authorized_rep_title'),
    authorizedRepEmail: text('authorized_rep_email'),
    // Regulatory license
    licenseType: text('license_type'),
    licenseNumber: text('license_number'),
    issuingAuthority: text('issuing_authority'),
    jurisdiction: text('jurisdiction'),
    // Document URLs (Vercel Blob)
    certOfIncorporationUrl: text('cert_of_incorporation_url'),
    regulatoryLicenseUrl: text('regulatory_license_url'),
    amlPolicyUrl: text('aml_policy_url'),
    // Review
    reviewNotes: text('review_notes'),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewedBy: text('reviewed_by'),
    submittedAt: timestamp('submitted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusIdx: index('partner_kyb_status_idx').on(t.status),
  })
)

// Server-side idempotency for side-effectful endpoints (e.g. withdrawals).
// A claim is inserted before the side effect; a retry with the same
// (scope, idem_key) replays the stored response instead of re-executing.
export const idempotencyKeys = pgTable(
  'idempotency_keys',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    scope: text('scope').notNull(),
    idemKey: text('idem_key').notNull(),
    status: text('status').notNull().default('processing'), // processing | completed
    responseStatus: integer('response_status'),
    responseBody: jsonb('response_body'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    scopeKeyUq: uniqueIndex('idempotency_keys_scope_key_uq').on(t.scope, t.idemKey),
    createdIdx: index('idempotency_keys_created_at_idx').on(t.createdAt),
  })
)

// Fixed-window rate-limit counters. Durable across serverless instances (unlike
// per-process memory). `bucket` = `${key}:${windowStartEpoch}`; one row per window.
export const rateLimits = pgTable(
  'rate_limits',
  {
    bucket: text('bucket').primaryKey(),
    count: integer('count').notNull().default(0),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => ({
    expiresIdx: index('rate_limits_expires_at_idx').on(t.expiresAt),
  })
)

// ─────────────────────────────────────────────────────────────────────────────
// Ramp API — wallet-less USDC ⇄ mobile-money settlement for partners
// ─────────────────────────────────────────────────────────────────────────────

export const rampDirection = pgEnum('ramp_direction', ['offramp', 'onramp'])

export const rampSettlementStatus = pgEnum('ramp_settlement_status', [
  'quoted',       // settlement created from a quote, not yet started
  'processing',   // generic in-flight
  'swapping',     // executing the USDC↔nTZS leg
  'paying_out',   // off-ramp: burn + PSP payout in flight
  'minting',      // on-ramp: awaiting PSP payin + mint
  'completed',
  'failed',
  'reverted',     // off-ramp payout failed and funds were re-minted/returned
])

/**
 * A locked FX quote a partner consumes when initiating a settlement. Rate is
 * fixed at quote time (admin midRate + LP spread) and held until expiresAt.
 */
export const rampQuotes = pgTable(
  'ramp_quotes',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
    direction: rampDirection('direction').notNull(),
    // USD/TZS rate locked for this quote (TZS per 1 USDC).
    rateUsdTzs: numeric('rate_usd_tzs', { precision: 18, scale: 6 }).notNull(),
    usdcAmount: numeric('usdc_amount', { precision: 36, scale: 6 }).notNull(),
    tzsAmount: bigint('tzs_amount', { mode: 'number' }).notNull(),
    feeTzs: bigint('fee_tzs', { mode: 'number' }).notNull().default(0),
    // Off-ramp destination bound to the quote (drizzle/0065). null / absent =
    // legacy wallet payout (mobile money). For lipa/bill:
    // { kind:'lipa', payNumber, network?, recipientName? }
    // { kind:'bill', utilityCode, utilityRef, recipientName? }
    // Binding it here keeps the fee honest: the quote priced THIS destination.
    destination: jsonb('destination'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partnerIdx: index('ramp_quotes_partner_id_idx').on(t.partnerId),
    expiresIdx: index('ramp_quotes_expires_at_idx').on(t.expiresAt),
  })
)

/**
 * One ramp settlement (off-ramp: USDC→mobile-money TZS, or on-ramp: TZS→USDC).
 * Drives the lifecycle, links to the burn/deposit legs, and powers webhooks +
 * reconciliation.
 */
export const rampSettlements = pgTable(
  'ramp_settlements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partnerId: uuid('partner_id').notNull().references(() => partners.id, { onDelete: 'cascade' }),
    direction: rampDirection('direction').notNull(),
    status: rampSettlementStatus('status').notNull().default('quoted'),

    quoteId: uuid('quote_id').references(() => rampQuotes.id),
    rateUsdTzs: numeric('rate_usd_tzs', { precision: 18, scale: 6 }).notNull(),
    usdcAmount: numeric('usdc_amount', { precision: 36, scale: 6 }).notNull(),
    tzsAmount: bigint('tzs_amount', { mode: 'number' }).notNull(),
    feeTzs: bigint('fee_tzs', { mode: 'number' }).notNull().default(0),
    // On-ramp fee split (off-ramp's split lives on burn_requests instead):
    // neda_fee_tzs = NEDA's protocol cut; fee_tx_hash / neda_fee_tx_hash are the
    // nTZS transfers of the partner / NEDA shares out of the settlement wallet.
    nedaFeeTzs: bigint('neda_fee_tzs', { mode: 'number' }).notNull().default(0),
    feeTxHash: text('fee_tx_hash'),
    nedaFeeTxHash: text('neda_fee_tx_hash'),

    // Off-ramp: recipient mobile-money phone. On-ramp: payer phone (push) +
    // optional address to forward delivered USDC to.
    recipientPhone: varchar('recipient_phone', { length: 32 }),
    destinationAddress: text('destination_address'),

    // Idempotency key from the initiating request (scope is per-partner).
    idempotencyKey: text('idempotency_key'),

    // Off-ramp destination + settlement evidence (drizzle/0065). null / absent =
    // legacy wallet payout. For lipa/bill: the bound destination plus, once
    // settled, { actualChargesTzs, selcomReceipt } — the reconciliation trail.
    destination: jsonb('destination'),

    // On-chain / PSP references, filled as legs complete.
    swapInTxHash: text('swap_in_tx_hash'),
    swapOutTxHash: text('swap_out_tx_hash'),
    burnRequestId: uuid('burn_request_id'),
    depositRequestId: uuid('deposit_request_id'),
    pspReference: text('psp_reference'),
    forwardTxHash: text('forward_tx_hash'),
    error: text('error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partnerIdx: index('ramp_settlements_partner_id_idx').on(t.partnerId),
    statusIdx: index('ramp_settlements_status_idx').on(t.status),
    createdIdx: index('ramp_settlements_created_at_idx').on(t.createdAt),
  })
)

/**
 * Daily reserve attestation — BoT sandbox Parameter 7 + 16. The 10:00 EAT
 * reconciliation snapshot submitted to the Bank of Tanzania: nTZS in circulation
 * vs the ring-fenced TZS reserve (custodial cash + government securities), and the
 * deviation from the strict 1:1 peg. One immutable row per EAT day; report_hash
 * makes each record tamper-evident.
 */
/**
 * Provider-declared reserve balances, entered by an operator from a statement
 * the provider sent (daily CSV, portal export) when its API is unavailable.
 *
 * Better evidence than carrying yesterday's reading forward — it is current and
 * it comes from the custodian — but a human transcribed it, so the attestation
 * marks it as not-read-live and it ages out on the same clock. Requires
 * drizzle/0077_reserve_statements.sql.
 */
export const reserveStatements = pgTable(
  'reserve_statements',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Matches the attestation pot key: 'snippe' | 'azampay' | 'selcom'. */
    potKey: text('pot_key').notNull(),
    amountTzs: numeric('amount_tzs', { precision: 36, scale: 2 }).notNull(),
    /** The STATEMENT's date, never the entry time. */
    asOf: timestamp('as_of', { withTimezone: true }).notNull(),
    /** Statement id / filename — what to ask the provider for on review. */
    reference: text('reference'),
    note: text('note'),
    /** The provider has suspended the account, so the balance cannot move.
     *  Ages on a longer clock than an ordinary statement — but still ages, in
     *  case the suspension is lifted without anyone telling us. Requires 0078. */
    frozen: boolean('frozen').notNull().default(false),
    /** What the frozen claim rests on: the suspension notice, ticket, or email. */
    frozenEvidence: text('frozen_evidence'),
    enteredByUserId: uuid('entered_by_user_id').references(() => users.id),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    potAsOfIdx: index('reserve_statements_pot_as_of_idx').on(t.potKey, t.asOf, t.createdAt),
  })
)

export const attestations = pgTable(
  'attestations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    reportDate: text('report_date').notNull().unique(), // 'YYYY-MM-DD' in EAT
    ntzsCirculation: numeric('ntzs_circulation', { precision: 36, scale: 2 }).notNull(),
    tzsCustodialReserve: numeric('tzs_custodial_reserve', { precision: 36, scale: 2 }).notNull(),
    tzsGovtSecurities: numeric('tzs_govt_securities', { precision: 36, scale: 2 }).notNull().default('0'),
    reserveTotal: numeric('reserve_total', { precision: 36, scale: 2 }).notNull(),
    // (reserve_total - ntzs_circulation) / ntzs_circulation * 100. Target 0.00%.
    deviationPct: numeric('deviation_pct', { precision: 12, scale: 6 }).notNull(),
    fullyBacked: boolean('fully_backed').notNull(),   // reserve_total >= ntzs_circulation (the hard rule)
    withinKpi: boolean('within_kpi').notNull(),       // not under-backed (peg intact)
    blockNumber: bigint('block_number', { mode: 'number' }),
    supplySource: text('supply_source').notNull(),
    reserveSource: text('reserve_source').notNull(),
    reportHash: text('report_hash').notNull(),
    emailedTo: text('emailed_to'),
    // Reserve composition + reconciliation-to-1:1 (attestation-math.ts shape).
    // Requires drizzle/0062_attestation_annex.sql applied manually in Neon;
    // until then the writer falls back to a legacy row (never select-all this
    // table from code that must survive the pre-apply window).
    annex: jsonb('annex'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    reportDateIdx: index('attestations_report_date_idx').on(t.reportDate),
    createdAtIdx: index('attestations_created_at_idx').on(t.createdAt),
  })
)

// ─────────────────────────────────────────────────────────────────────────────
// Developer TEST MODE (see drizzle/0066_test_mode.sql)
//
// ⚠ This is the DEVELOPER sandbox (Stripe-style test keys) — NOT the Bank of
// Tanzania regulatory sandbox, which lives in lib/sandbox/limits.ts.
//
// Isolation is structural: a test partner's traffic writes ONLY here. Nothing
// in this section is ever read by attestation, supply, reserve pots, the
// payout/burn engines or any Backstage aggregate — so simulated money cannot
// reach a regulator-facing number by construction.
// ─────────────────────────────────────────────────────────────────────────────

export const testModeUsers = pgTable(
  'test_mode_users',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    email: text('email'),
    name: text('name'),
    phone: text('phone'),
    /** Deterministic fake EVM address (valid checksum, never funded on chain). */
    walletAddress: text('wallet_address').notNull(),
    balanceTzs: bigint('balance_tzs', { mode: 'number' }).notNull().default(0),
    kycStatus: text('kyc_status').notNull().default('approved'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partnerExternalUq: uniqueIndex('test_mode_users_partner_external_uq').on(t.partnerId, t.externalId),
  })
)

export const testModeTransactions = pgTable(
  'test_mode_transactions',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    partnerId: uuid('partner_id')
      .notNull()
      .references(() => partners.id, { onDelete: 'cascade' }),
    userId: uuid('user_id').references(() => testModeUsers.id, { onDelete: 'cascade' }),
    /** 'deposit' | 'withdrawal' | 'spend' | 'transfer' */
    kind: text('kind').notNull(),
    /** 'pending' | 'completed' | 'failed' | 'reconcile_required' */
    status: text('status').notNull(),
    amountTzs: bigint('amount_tzs', { mode: 'number' }).notNull().default(0),
    /** Signed effect on the user's simulated balance, applied at settlement. */
    balanceDeltaTzs: bigint('balance_delta_tzs', { mode: 'number' }).notNull().default(0),
    fees: jsonb('fees'),
    detail: jsonb('detail'),
    /** When a pending row becomes terminal — swept on the next API call. */
    settlesAt: timestamp('settles_at', { withTimezone: true }),
    settledAt: timestamp('settled_at', { withTimezone: true }),
    webhookSent: boolean('webhook_sent').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    partnerCreatedIdx: index('test_mode_transactions_partner_created_idx').on(t.partnerId, t.createdAt),
    dueIdx: index('test_mode_transactions_due_idx').on(t.status, t.settlesAt),
  })
)

/**
 * Evidence that the BoT Testing Parameters bind (drizzle/0069).
 *
 * One row per BLOCKED attempt. The caps were always enforced; until this table
 * they were never recorded, so a periodic return could assert compliance but
 * not evidence it. A supervisor asks "show me it working" — these rows are the
 * answer.
 *
 * Evidence only: nothing reads this to make a decision, so the recorder is
 * fail-soft and a write failure can never affect a money path.
 */
export const sandboxLimitEvents = pgTable(
  'sandbox_limit_events',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull().defaultNow(),
    /** 'per_txn_cap' (#3) | 'daily_user_cap' (#4) | 'monthly_user_cap' (#5) */
    code: text('code').notNull(),
    /** Counted against: 'user' | 'sub_wallet' | 'ramp_counterparty'. */
    subjectKind: text('subject_kind').notNull(),
    /** Set only when the subject is a row of ours (user / sub-wallet). */
    subjectId: uuid('subject_id'),
    /**
     * The subject's canonical ref, always set (drizzle/0073). For a ramp
     * counterparty this is the only identity — 'lipa:61115582',
     * 'bill:LUKU:24219217817', 'phone:0744…' — a wallet in the country, not a
     * row in our database, which is why subject_id alone could not hold it.
     */
    subjectRef: text('subject_ref'),
    partnerId: uuid('partner_id'),
    endpoint: text('endpoint'),
    /** 'quote' | 'execute' — the same attempt can be blocked at both stages. */
    stage: text('stage'),
    requestedTzs: bigint('requested_tzs', { mode: 'number' }).notNull(),
    limitTzs: bigint('limit_tzs', { mode: 'number' }).notNull(),
    usedInPeriodTzs: bigint('used_in_period_tzs', { mode: 'number' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    codeOccurredIdx: index('sandbox_limit_events_code_occurred_idx').on(t.code, t.occurredAt),
    subjectIdx: index('sandbox_limit_events_subject_idx').on(t.subjectKind, t.subjectId),
    occurredIdx: index('sandbox_limit_events_occurred_idx').on(t.occurredAt),
  })
)

/**
 * The curated incident register — see drizzle/0070.
 *
 * Not an event feed (that is `activity`). An incident is a human judgement
 * that something went wrong enough to write down, so entries are prose,
 * written by a person, and each one has to name the control that was added.
 *
 * There is deliberately no delete path in the application: entries are updated
 * and every update writes an audit log. `funds_lost_tzs` is explicit including
 * zero, because "no customer lost funds" should be the sum of a column rather
 * than an assurance — NULL means unknown, not none.
 */
export const incidents = pgTable(
  'incidents',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    /** Human key, e.g. INC-2026-07-006. */
    ref: text('ref').notNull().unique(),
    title: text('title').notNull(),
    /** 'sev1' | 'sev2' | 'sev3' | 'sev4' */
    severity: text('severity').notNull(),
    /** 'money' | 'availability' | 'compliance' | 'security' | 'data' */
    category: text('category').notNull(),
    /** 'open' | 'mitigated' | 'resolved' */
    status: text('status').notNull().default('open'),

    /** Start of the exposure window, or the detection date when it cannot be dated honestly. */
    occurredAt: timestamp('occurred_at', { withTimezone: true }).notNull(),
    detectedAt: timestamp('detected_at', { withTimezone: true }),
    resolvedAt: timestamp('resolved_at', { withTimezone: true }),
    /** 'monitoring' | 'log_review' | 'customer' | 'partner' | 'internal_review' | 'regulator' */
    detectedBy: text('detected_by'),

    whatHappened: text('what_happened').notNull(),
    customerImpact: text('customer_impact').notNull(),
    customersAffected: integer('customers_affected'),
    fundsAtRiskTzs: bigint('funds_at_risk_tzs', { mode: 'number' }),
    fundsLostTzs: bigint('funds_lost_tzs', { mode: 'number' }),

    rootCause: text('root_cause'),
    resolution: text('resolution'),
    /** What now makes recurrence structurally harder — a test, a gate, a chokepoint. */
    controlAdded: text('control_added'),
    /** Where to verify it: PR number, commit, log query. */
    evidenceRef: text('evidence_ref'),

    /** Disclosure is a decision, not a default — this starts false on every row. */
    reportedToBot: boolean('reported_to_bot').notNull().default(false),
    reportedToBotAt: timestamp('reported_to_bot_at', { withTimezone: true }),
    botReportRef: text('bot_report_ref'),

    createdByUserId: uuid('created_by_user_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    occurredIdx: index('incidents_occurred_idx').on(t.occurredAt),
    statusIdx: index('incidents_status_idx').on(t.status),
    severityIdx: index('incidents_severity_idx').on(t.severity),
    reportedIdx: index('incidents_reported_idx').on(t.reportedToBot),
  })
)
