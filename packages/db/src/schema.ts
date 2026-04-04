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

export const pspProvider = pgEnum('psp_provider', ['bank_transfer', 'zenopay', 'snippe', 'snippe_card'])

export const transferStatus = pgEnum('transfer_status', ['pending', 'submitted', 'completed', 'failed'])

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

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    neonAuthUserIdUq: uniqueIndex('users_neon_auth_user_id_uq').on(t.neonAuthUserId),
    payAliasUq: uniqueIndex('users_pay_alias_uq').on(t.payAlias),
    bankIdx: index('users_bank_id_idx').on(t.bankId),
    roleIdx: index('users_role_idx').on(t.role),
  })
)

export const kycCases = pgTable(
  'kyc_cases',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    nationalId: text('national_id').notNull(),
    status: kycStatus('status').notNull().default('pending'),

    provider: text('provider').notNull().default('manual'),
    providerReference: text('provider_reference'),

    reviewedByUserId: uuid('reviewed_by_user_id').references(() => users.id),
    reviewedAt: timestamp('reviewed_at', { withTimezone: true }),
    reviewReason: text('review_reason'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index('kyc_cases_user_id_idx').on(t.userId),
    statusIdx: index('kyc_cases_status_idx').on(t.status),
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

    // 'self' = user's own deposit, 'pay_link' = collection via Pay Me link
    source: text('source').notNull().default('self'),
    payerName: text('payer_name'),

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
    webhookUrl: text('webhook_url'),
    webhookSecret: text('webhook_secret'),
    encryptedHdSeed: text('encrypted_hd_seed'),
    nextWalletIndex: integer('next_wallet_index').notNull().default(0),
    nextSubWalletIndex: integer('next_sub_wallet_index').notNull().default(1),
    isActive: boolean('is_active').notNull().default(true),
    suspendedAt: timestamp('suspended_at', { withTimezone: true }),
    suspendReason: text('suspend_reason'),
    dailyLimitTzs: bigint('daily_limit_tzs', { mode: 'number' }),
    contractSignedAt: timestamp('contract_signed_at', { withTimezone: true }),
    treasuryWalletAddress: text('treasury_wallet_address'),
    feePercent: numeric('fee_percent').notNull().default('0'),
    payoutPhone: text('payout_phone'),
    payoutType: text('payout_type').default('mobile'),
    payoutBankAccount: text('payout_bank_account'),
    payoutBankName: text('payout_bank_name'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
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
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
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

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    emailUq: uniqueIndex('lp_accounts_email_uq').on(t.email),
    walletIndexUq: uniqueIndex('lp_accounts_wallet_index_uq').on(t.walletIndex),
    walletAddressUq: uniqueIndex('lp_accounts_wallet_address_uq').on(t.walletAddress),
    kycIdx: index('lp_accounts_kyc_status_idx').on(t.kycStatus),
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
    pairUq: uniqueIndex('lp_fx_pairs_tokens_uq').on(t.token1Address, t.token2Address),
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
    tokenAddress: text('token_address').notNull(),
    tokenSymbol: text('token_symbol').notNull(),
    decimals: integer('decimals').notNull().default(18),
    contributed: numeric('contributed', { precision: 36, scale: 18 }).notNull().default('0'),
    earned: numeric('earned', { precision: 36, scale: 18 }).notNull().default('0'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lpTokenUq: uniqueIndex('lp_pool_positions_lp_token_uq').on(t.lpId, t.tokenAddress),
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
    userAddress: text('user_address').notNull(),
    fromToken: text('from_token').notNull(),
    toToken: text('to_token').notNull(),
    amountIn: numeric('amount_in', { precision: 36, scale: 18 }).notNull(),
    amountOut: numeric('amount_out', { precision: 36, scale: 18 }).notNull(),
    spreadEarned: numeric('spread_earned', { precision: 36, scale: 18 }).notNull().default('0'),
    inTxHash: text('in_tx_hash').notNull(),
    outTxHash: text('out_tx_hash').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    lpIdx: index('lp_fills_lp_id_idx').on(t.lpId),
    createdIdx: index('lp_fills_created_at_idx').on(t.createdAt),
    userAddrIdx: index('lp_fills_user_address_idx').on(t.userAddress),
  })
)

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
