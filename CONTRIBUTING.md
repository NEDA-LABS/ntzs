# Contributing to nTZS

This guide covers everything you need to contribute safely to this codebase. nTZS is a regulated financial system — mistakes here can affect real money, on-chain supply, and BoT sandbox compliance.

---

## Environment Setup

```bash
git clone https://github.com/mxsafiri/n-tzs.git
cd n-tzs
node --version   # must be >= 22
npm install
cp .env.example .env.local
# fill in your keys — never use mainnet keys locally
npm run dev:web       # http://localhost:3000
npm run dev:worker    # separate terminal
```

**Never point `MINTER_PRIVATE_KEY` or `DATABASE_URL` at production when developing locally.** Use Base Sepolia (`84532`) and a Neon branch or local Postgres.

---

## Branch Naming

| Type | Pattern | Example |
|---|---|---|
| Feature | `feat/<short-description>` | `feat/biometric-kyc` |
| Bug fix | `fix/<short-description>` | `fix/burn-double-approval` |
| Compliance / regulatory | `compliance/<ref>-<description>` | `compliance/para8-pep-screening` |
| Smart contract | `contract/<description>` | `contract/ntzsv3-upgrade` |
| Chore / refactor | `chore/<description>` | `chore/drizzle-schema-cleanup` |

All branches cut from `main`. Keep branches short-lived.

---

## PR Checklist

Before opening a PR, verify every item that applies to your change.

### General
- [ ] Branch is up to date with `main`
- [ ] TypeScript compiles with no errors (`npm run build:web`)
- [ ] Lint passes (`npm run lint:web`)
- [ ] No hardcoded secrets, private keys, or API keys in diff
- [ ] `.env` / `.env.local` not committed (covered by `.gitignore`)

### Database changes
- [ ] New Drizzle migration generated (`npm run db:generate`) and committed
- [ ] Migration is additive / backwards-compatible — no column drops without a deprecation cycle
- [ ] New columns that will be read by the worker have defaults or are nullable
- [ ] Migration tested against a clean schema (`npm run db:migrate`)

### API / business logic
- [ ] All new endpoints validate input at the boundary (zod or equivalent)
- [ ] New deposit / burn / transfer paths enforce transaction limits (`lib/sandbox/limits.ts`)
- [ ] Any new minting path checks the daily issuance cap (`dailyIssuance` table)
- [ ] Idempotency keys or status guards prevent double-processing
- [ ] All material operations write an audit log entry

### Smart contract changes (`packages/contracts`)
- [ ] Change is confined to a new contract version (do not modify deployed contracts)
- [ ] Unit tests updated or added in `test/`
- [ ] `npm run test` passes in `packages/contracts`
- [ ] ABI changes are reflected in any off-chain callers (`apps/worker`, `apps/web`)
- [ ] UUPS upgrade compatibility verified (storage layout unchanged)
- [ ] Deployment script updated if a new proxy upgrade is needed

### BoT sandbox compliance
If your change touches any of the areas below, confirm the relevant parameter is still satisfied:

| Area | Parameter |
|---|---|
| Per-transaction cap (TZS 1,000,000) | Para #3 |
| Daily per-user limit (TZS 2,000,000) | Para #4 |
| Monthly per-user cap (TZS 60,000,000) | Para #5 |
| Platform daily issuance cap (TZS 100,000,000) | Para #6 |
| User-facing terminology (no "nTZS" visible) | Para #12 |
| Sandbox user cap (100 users) | Para #2 |

- [ ] No limit values modified without explicit approval from the MD
- [ ] UI changes audited: users see "TZS" not "nTZS" terminology

### Security-sensitive changes
- [ ] No new admin roles or contract permissions added without review
- [ ] Webhook handlers verify signatures before processing
- [ ] New backstage routes are behind authentication middleware
- [ ] No user-supplied input is used in raw SQL or shell commands

---

## Commit Style

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat(kyc): add Smile Identity biometric verification
fix(worker): prevent double-mint on webhook retry
compliance(para8): add PEP screening before wallet activation
contract(v3): add version() introspection to NTZSV3
chore(db): remove deprecated zenopay_legacy columns
```

Keep the subject line under 72 characters. Add a body if the *why* is non-obvious.

--- 

## Key Invariants — Never Break These

1. **On-chain is the source of truth.** If a mint or burn happens on-chain, there must be a corresponding DB record. Manual on-chain operations require a reconciliation entry.
2. **Minting requires prior fiat confirmation.** No deposit may reach `mint_pending` without both bank approval and platform compliance approval.
3. **Burns require dual sign-off.** A burn request must pass through `requires_second_approval` before `burn_submitted`.
4. **Audit logs are append-only.** Never delete or update audit log rows.
5. **Mainnet contract addresses are fixed.** Do not modify `NTZS_CONTRACT_ADDRESS_BASE` references without a full upgrade process.

---

## Getting Help

- Architecture: [`docs/01-ARCHITECTURE.md`](docs/01-ARCHITECTURE.md)
- Deposit lifecycle: [`docs/02-DEPOSIT-TO-MINT-LIFECYCLE.md`](docs/02-DEPOSIT-TO-MINT-LIFECYCLE.md)
- Smart contract: [`docs/04-SMART-CONTRACT.md`](docs/04-SMART-CONTRACT.md)
- Security model: [`docs/05-SECURITY-MODEL.md`](docs/05-SECURITY-MODEL.md)
- Operations runbook: [`docs/06-OPERATIONS-RUNBOOK.md`](docs/06-OPERATIONS-RUNBOOK.md)
