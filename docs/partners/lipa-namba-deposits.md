# Lipa Namba deposits — integration brief

**For**: the NEDApay engineering team
**Base URL**: `https://www.ntzs.co.tz`
**Reference**: `09-WAAS-PARTNER-API.md` — v1.21.0, and the Collections section on /developers

---

## What this is, in one paragraph

A deposit method where **your user pays us, instead of us prompting them**. You create a deposit intent, we hand back payment instructions (our Lipa Namba business number + the exact amount), the user completes an ordinary *Lipa kwa M-Pesa / Lipa Namba* payment from their **own** mobile-money menu, and nTZS mints to their wallet automatically a few minutes later. No USSD push, no PIN prompt from us, nothing for the user to approve on a screen they didn't open.

Because the **user initiates the payment**, this method works on **every network** — including when no push rail can reach that network. Right now that matters concretely: **this is the only way a Vodacom M-Pesa user can deposit.** Prioritise it accordingly.

## The whole flow

```
1. Your backend  →  POST /api/v1/deposits  (creates the intent)
2. Your app      →  shows the instructions we return
3. Your user     →  pays our Lipa Namba from their own M-Pesa menu
4. Our side      →  matches the credit, mints nTZS (~5 min, up to ~10)
5. Your backend  →  polls GET /api/v1/deposits/:id until status "minted"
```

Steps 1–2 and 5 are yours. Steps 3–4 involve no call to us at all — that's the point.

## Step 1 — Create the intent

```http
POST /api/v1/deposits
Authorization: Bearer ntzs_live_xxxxxxxxxxxx
Content-Type: application/json

{
  "userId": "14e17d04-ec7f-4d99-91a3-dfbaca19fba1",
  "amountTzs": 10000,
  "paymentMethod": "lipa_namba",
  "phoneNumber": "255744123456",
  "idempotencyKey": "your-unique-key-per-attempt"
}
```

| Field | Required | The thing to get right |
|---|---|---|
| `userId` | ✓ | The **nTZS user id** returned by `POST /api/v1/users` — not your own `externalId`. (Same rule that bit the Pay Bill flow this week; same fix.) |
| `amountTzs` | ✓ | Integer shillings. This exact figure is half of the matching key. |
| `paymentMethod` | ✓ | `"lipa_namba"` |
| `phoneNumber` | ✓ | **The number the user will PAY FROM.** This is the other half of the matching key — it is *not* a number we send anything to. Any common TZ format; we normalise. |
| `idempotencyKey` | recommended | Makes retries safe. Without it, a double-submit creates two open intents with the same amount and phone — which *guarantees* the payment cannot auto-match (see "ambiguity" below). |

### Get `phoneNumber` right — it's an identity claim, not contact info

Ask the user explicitly: *"Which number will you pay from?"* — pre-filled with their registered number, but editable. A user topping up from their second SIM, or a spouse's phone, must enter *that* number, or their payment lands in manual review instead of auto-crediting.

## Step 2 — Show the instructions

```json
201 Created
{
  "id": "b7e2…",
  "status": "submitted",
  "amountTzs": 10000,
  "paymentMethod": "lipa_namba",
  "instructions": {
    "lipaNamba": "70031820",
    "accountName": "NEDA LABS LIMITED",
    "amountTzs": 10000,
    "payFromPhone": "255744123456",
    "note": "Pay EXACTLY this amount from EXACTLY this phone number via \"Lipa by M-Pesa / Lipa Namba\" in the mobile money menu. The deposit is credited automatically once the payment lands (typically under 5 minutes)."
  }
}
```

Render `lipaNamba`, `accountName` and `amountTzs` large. The `accountName` matters: it's what the user's M-Pesa confirm screen will show, so displaying it lets them verify they're paying the right business before entering their PIN.

**The two rules your UI must make impossible to miss:**

1. **Pay exactly `amountTzs`.** Not rounded up, not plus-something.
2. **Pay from `payFromPhone`.** Not another SIM, not someone else's phone.

Both are the matching key. Break either and the money still arrives safely — but it parks for a human instead of crediting in minutes.

**Also say this:** *"Your mobile network may charge its own fee on top."* M-Pesa adds its transaction fee (e.g. 50 TZS on 1,000) — the user pays 1,050 total, we receive and mint 1,000. Without that line in your UI, "I paid 1,050 and only got 1,000" becomes your support ticket.

Persist the instructions (or re-render from your own record): `GET /deposits/:id` returns status, not the instructions block. The `lipaNamba` number itself is constant, so this is trivial.

Localise the `note` freely — it's guidance copy, not a contract.

## Step 3 — The user pays (nothing calls us)

In their own phone: **Lipa kwa M-Pesa → Lipa Namba → business number `70031820` → amount → PIN.** Same flow they use at any shop. Works equally from Airtel Money, Mixx by Yas and HaloPesa menus — the method is not M-Pesa-only, it's just most needed there.

Give them an "I have paid" button that flips your UI into a "confirming your payment…" state and starts your polling loop. Don't block them in the app — the mint completes whether or not they sit and watch.

## Step 4 — Poll until minted

```http
GET /api/v1/deposits/b7e2…
Authorization: Bearer ntzs_live_xxxxxxxxxxxx
```

```json
{ "id": "b7e2…", "status": "minted", "amountTzs": 10000,
  "paymentMethod": "lipa_namba",
  "txHash": "0x…", "createdAt": "…" }
```

- `submitted` → still waiting for the payment (or for the next matching pass — the matcher runs every 5 minutes).
- `minted` + `txHash` → done; the user's wallet holds the nTZS. **This is the terminal success state.**
- Intermediate states may appear briefly between the two; treat anything that isn't `minted` as "in progress".

Sensible polling: every 15–30 seconds for the first 10 minutes after "I have paid", then back off. There is no completion webhook for deposits today — polling is the contract (true of every deposit method, not just this one).

## When something goes wrong — nothing is lost, some things go manual

| What happened | What we do | What you tell the user |
|---|---|---|
| Paid a different amount | Credit parks for manual review | "Your payment arrived and is being confirmed manually — usually same day." |
| Paid from a different number | Same | Same |
| Paid with no intent created | Same | Same |
| Paid more than 72h after the intent | Same — the match window closed | Same |
| Two identical open intents (same amount + phone) | Both refuse to auto-match — crediting one over the other would be a guess | Prevented by `idempotencyKey` + one-open-intent-per-user UX |
| User never pays | Intent just ages out; nothing happens | Let them create a fresh intent whenever they're ready |

The design rule behind all of these: **the matcher only credits automatically when the match is beyond doubt.** Everything less lands in a human review queue on our side — money is never lost, it just waits for eyes. If a user reports a payment that hasn't credited within ~15 minutes, collect the M-Pesa confirmation SMS (amount, time, the number they paid from) and send it to us — that's exactly what the reviewer needs.

There is no cancel endpoint. An unpaid intent is inert and simply falls out of the matching window after 72 hours; if the user wants a different amount, create a new intent and make clear they must pay the **new** figure.

## Sandbox

Your `ntzs_test_` key accepts the same request and returns the same shapes, so the whole screen is buildable before touching real money. Test-mode deposits follow the standard scenario rules (the last two digits of the phone number decide the simulated outcome — see the Test Mode section of the API reference), so you can rehearse success, pending and failure paths deterministically.

## Design recommendations, from us having watched this fail

- **One open Lipa Namba intent per user at a time.** Enforce it in your UX. It removes the ambiguity case entirely.
- **Don't let the user edit the amount after the instructions are shown.** New amount = new intent.
- **Pre-fill `phoneNumber` with their registered number but let them change it**, with copy like "the number you'll pay from".
- **Show `accountName` prominently** — it's their confirmation they're paying the right business.
- The fee line. Seriously. It's one sentence and it deletes a whole category of ticket.

## Questions

API behaviour → NEDA Labs engineering. A payment that hasn't credited → send the M-Pesa SMS details with the deposit `id`.
