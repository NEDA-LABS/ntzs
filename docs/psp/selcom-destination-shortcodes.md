# Selcom Destination Shortcodes — canonical FI-code table

**Source**: https://prelive.selcom.business/developer → "Destination Shortcodes"
(credential-gated portal), captured **1 Aug 2026** by the operator.
**Why this file exists**: the adapter originally shipped with a different,
VMCASHIN-style code table that turned out to be wrong — every wallet cash-in
answered `651 Invalid or inactive bank/FI code`, which on 1 Aug 2026 meant a
platform-wide cash-out outage. This table self-validated the same day: its
Vodacom entry (`MPESA`) was proven by a live 1,000 TZS dispatch
(ref `16437765-f972-49c4-9231-74f09d815298`, Selcom Biz confirmation received).

**Rule**: a vendor code word is an empirical claim. Before relying on any code
at volume, prove one live dispatch through `/backstage/selcom-spend` → Wallet
payout. Update the "Proven" column when you do.

These codes are the `recipientFiCode` for `POST /v1/transaction/process`
(wallet and bank disbursements — `processDisbursement` in `lib/psp/selcom.ts`)
and the `bank` vocabulary Selcom's surfaces share.

## Mobile wallets

| Destination | Shortcode | Reference type | Lookup | Proven |
|---|---|---|---|---|
| Vodacom M-Pesa | `MPESA` | NUMERIC | Enabled | ✅ live dispatch 1 Aug 2026 |
| Airtel Money | `AIRTELMONEY` | NUMERIC | Enabled | ✅ live dispatch 1 Aug 2026 |
| Mixx by Yas (ex Tigo Pesa) | `MIXXBYYAS` | NUMERIC | Enabled | — probe before volume |
| Halo Pesa | `HALOPESA` | NUMERIC | Enabled | — probe before volume |
| TTCL Pesa | `TTCLPESA` | NUMERIC | Enabled | — probe before volume |
| Selcom Bank / Selcom Pesa / Selcom Business | `SELCOM` | NUMERIC | Enabled | |

## Banks

`sendBankPayout` passes `bankName` straight through as the FI code — it must be
one of these shortcodes, never a free-text bank name.

| Destination | Shortcode | Reference type | Lookup |
|---|---|---|---|
| Absa Bank | `ABSA` | NUMERIC | Enabled |
| Access Bank | `BANCABC` | NUMERIC | Enabled |
| Akiba Bank | `ACB` | NUMERIC | Enabled |
| Amana Bank | `AMANA` | NUMERIC | Enabled |
| Azania Bank | `AZANIA` | NUMERIC | Enabled |
| Bank of Africa | `BOA` | NUMERIC | Enabled |
| Bank of Baroda | `BOBTZ` | NUMERIC | Enabled |
| Bank of India | `BOI` | NUMERIC | Enabled |
| Bank of Tanzania | `BOT` | NUMERIC | **No** |
| Canara Bank | `CANARA` | NUMERIC | Enabled |
| Citi Bank | `CITI` | NUMERIC | Enabled |
| CRDB Bank | `CRDB` | **ALPHANUMERIC** | Enabled |
| DCB Commercial Bank | `DCB` | NUMERIC | Enabled |
| Diamond Trust Bank | `DTB` | NUMERIC | Enabled |
| Ecobank | `ECOBANK` | NUMERIC | Enabled |
| Equity Bank | `EQUITY` | NUMERIC | Enabled |
| Exim Bank | `EXIM` | NUMERIC | Enabled |
| Finca Microfinance Bank | `FINCA` | NUMERIC | Enabled |
| Guaranty Trust Bank | `GTBANK` | NUMERIC | Enabled |
| Habib African Bank | `HABIB` | NUMERIC | Enabled |
| I&M Bank | `IMBANK` | NUMERIC | Enabled |
| International Commercial Bank | `ICB` | NUMERIC | Enabled |
| KCB Bank | `KCB` | NUMERIC | Enabled |
| Letshego Bank | `LETSHEGO` | NUMERIC | Enabled |
| Maendeleo Bank | `MAENDELEO` | NUMERIC | Enabled |
| Mkombozi Commercial Bank | `MKOMBOZI` | NUMERIC | Enabled |
| MUCOBA Bank | `MUCOBA` | NUMERIC | Enabled |
| Mwalimu Commercial Bank | `MWALIMU` | NUMERIC | Enabled |
| Mwanga Hakika Bank | `MWANGA` | NUMERIC | Enabled |
| National Bank of Commerce | `NBC` | NUMERIC | Enabled |
| NCBA Bank | `NCBA` | NUMERIC | Enabled |
| NMB Bank | `NMB` | NUMERIC | Enabled |
| People's Bank of Zanzibar | `PBZ` | NUMERIC | Enabled |
| Stanbic Bank | `STANBIC` | NUMERIC | Enabled |
| Standard Chartered Bank | `SCB` | NUMERIC | Enabled |
| Tanzania Commercial Bank | `TCB` | NUMERIC | Enabled |
| Uchumi Commercial Bank | `UCHUMI` | NUMERIC | Enabled |
| United Bank for Africa | `UBA` | NUMERIC | Enabled |

Notes: CRDB is the only ALPHANUMERIC reference type (account formats differ);
Bank of Tanzania has lookup disabled.
