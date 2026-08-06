# Paying a TANQR / Lipa Namba QR with nTZS

**For**: partner engineering teams building scan-to-pay
**Base URL**: `https://www.ntzs.co.tz`
**Reference**: `09-WAAS-PARTNER-API.md` — Spend, and Merchant name lookup

---

## Read this first: there is nothing to enable

TANQR is not a separate payment rail, a separate integration, or a feature flag on your account. It is a **QR code that contains a merchant's Lipa Namba** — the same till number a customer could read off the counter and type in by hand.

So the whole of "TANQR support" is:

```
scan → get the till number out of the code → pay that till
```

and the paying part is the `/v1/spend` endpoints you may already be using. There is no `/tanqr` endpoint and nothing for us to switch on for you. If someone has told you TANQR enablement is a separate workstream, that is the confusion this document exists to end.

The one genuinely non-obvious part is getting the till number out of the code, because a QR payload is not a till number — it is a structured binary-ish string. `POST /api/v1/lookup/qr` does that for you.

---

## The whole flow

```
 1. Camera reads a string          →  "00020101021126…6304A13F"
 2. POST /v1/lookup/qr             →  { payNumber, merchantName, amountTzs? }
 3. Show the user who they're paying and how much
 4. POST /v1/spend/quote           →  fees + a signed quoteId
 5. Show the fee breakdown
 6. POST /v1/spend                 →  paid
```

Steps 2 and 4 both cost you nothing and move no money. Step 6 is the only one that spends.

---

## Step 1 — Scan

Any QR library. You are reading a **text** payload; don't let a library try to interpret it as a URL. A TANQR payload always begins `000201`.

If the string starts with anything else — `http`, a deep link, an address — it is not a merchant QR. Handle it in your own app; step 2 will tell you so explicitly rather than failing mysteriously.

## Step 2 — Turn the scan into a till number

```http
POST /api/v1/lookup/qr
Authorization: Bearer ntzs_live_xxxxxxxxxxxx
Content-Type: application/json

{ "payload": "00020101021126360016tz.go.bot.tanqr0106123456…6304A13F" }
```

```json
200 OK
{
  "kind": "lipa",
  "payNumber": "123456",
  "merchantName": "KARIAKOO HARDWARE LIMITED",
  "qrMerchantName": "KARIAKOO HARDWARE",
  "nameMatch": true,
  "amountTzs": null,
  "dynamic": false,
  "currency": "TZS",
  "countryCode": "TZ",
  "reference": null,
  "resolution": "resolved",
  "warnings": []
}
```

**`payNumber` is the answer.** It is an ordinary Lipa Namba and everything downstream takes it exactly as if the user had typed it.

### What the other fields are for

| Field | Use it for |
|---|---|
| `merchantName` | The name to show the user. This comes from the acquirer's records, not from the QR. |
| `qrMerchantName` | The name printed *inside* the QR. Shown for comparison — see the safety section. |
| `nameMatch` | `false` means those two names disagree. **Warn the user.** |
| `amountTzs` | Set on a *dynamic* QR (the merchant already entered the amount). `null` on a static one — you collect the amount. |
| `dynamic` | `true` = amount came from the merchant. `false` = a permanent sticker. |
| `reference` | An invoice/reference the merchant attached. Show it; it helps them reconcile. |
| `resolution` | `resolved` is the only one you may pay against. See below. |
| `warnings` | Human-readable strings. If non-empty, show them. |

### `resolution` — check this before paying

| Value | Meaning | Do |
|---|---|---|
| `resolved` | Exactly one registered merchant. `payNumber` is trustworthy. | Proceed. |
| `unresolved` | Valid code, but nothing in it resolves to a registered merchant. | **Do not pay.** Ask the user to type the till number printed next to the QR. |
| `ambiguous` | The code contains more than one registered merchant account. | **Do not pay.** Show `candidates` and make the user choose. |

We return `ambiguous` rather than picking one, because picking one would be picking who receives the money.

### Errors

| Code | Meaning | Show the user |
|---|---|---|
| `not_a_merchant_qr` | Not an EMVCo/TANQR code — often a URL. | "That isn't a payment code." |
| `checksum_failed` | The code's contents don't match its checksum — damaged, mis-scanned, or altered. | "Couldn't read that code safely. Try again or pay by till number." **Never pay against it.** |
| `malformed_payload` | Structurally broken. | Same as above. |
| `payload_too_long` | Longer than a QR code can legitimately be. | Same as above. |

## Step 3 — Confirm with the user

Show `merchantName`, and the amount. This is a regulatory expectation as well as a UX one: the customer must see who they are paying before they pay.

If `nameMatch` is `false`, show **both** names and make the confirmation deliberate.

## Step 4 — Quote

```http
POST /api/v1/spend/quote
Authorization: Bearer ntzs_live_xxxxxxxxxxxx

{
  "userId":    "14e17d04-ec7f-4d99-91a3-dfbaca19fba1",
  "kind":      "lipa",
  "payNumber": "123456",
  "amountTzs": 5000
}
```

Returns the fee breakdown and a signed `quoteId` valid for five minutes. Show the user the total before they commit — `/v1/spend` will refuse to execute without a quote, by design.

For a dynamic QR, `amountTzs` is the value from step 2. For a static one, it's whatever the user typed.

**Fees** follow Selcom's Lipa/TanQR tariff — around **30 TZS on a 1,000 TZS payment**. QR and typed till payments are charged identically; scanning costs nothing extra.

## Step 5 — Pay

```http
POST /api/v1/spend
Authorization: Bearer ntzs_live_xxxxxxxxxxxx

{
  "userId":    "14e17d04-ec7f-4d99-91a3-dfbaca19fba1",
  "kind":      "lipa",
  "payNumber": "123456",
  "amountTzs": 5000,
  "quoteId":   "<from step 4>"
}
```

The user's nTZS is burned and the merchant's till is credited in shillings.

---

## Static vs dynamic codes

**Static** — a printed sticker on the counter, same code for every customer, no amount. `dynamic: false`, `amountTzs: null`. Your UI must ask for the amount. This is the overwhelming majority of codes in the wild.

**Dynamic** — generated per transaction on a POS screen, carries the amount. `dynamic: true`, `amountTzs` populated. **Use that amount, don't ask the user to retype it** — a mismatch between the screen and what's paid is a support ticket.

A sensible rule: if `amountTzs` is present, show it as a fixed, non-editable figure.

---

## Safety: the sticker-swap attack

The realistic attack on printed QR is not cryptographic — it is a person with a printer. They paste their own QR over the merchant's. The customer stands in the right shop, sees the right shopfront, scans, and pays a stranger.

Two defences are built into step 2, and both need your UI to cooperate:

1. **`nameMatch`.** The name inside the QR is controlled by whoever printed it; the name we return in `merchantName` comes from the acquirer's records and is not. When they disagree we return `false` and a warning. A user who is shown *"This code says KARIAKOO HARDWARE but the account belongs to JOHN MTEMBEI GENERAL SUPPLIES"* will stop. One who is shown nothing will not.

2. **The checksum.** Every EMVCo code carries a CRC over its own contents. We verify it and refuse the scan if it fails, so a code that was crudely edited never reaches your payment screen.

Neither helps if your app displays `qrMerchantName` instead of `merchantName`. **Display `merchantName`.** It is the one of the two an attacker cannot choose.

---

## Testing

`/v1/lookup/qr` works fully on a **test key** — it decodes for real and returns a resolved merchant without calling the acquirer, so the whole scan → confirm → quote → pay screen is buildable in sandbox before any rail is live.

Two valid sample payloads, checksums correct. Send either as `payload` directly, or encode it as a QR image with any generator and point a real camera at it:

**Static** — a counter sticker, no amount:

```
00020101021126290015tz.go.bot.tanqr01061234565204531153038345802TZ5917KARIAKOO HARDWARE6013DAR ES SALAAM63047314
```

```json
{ "payNumber": "123456", "merchantName": "KARIAKOO HARDWARE",
  "amountTzs": null, "dynamic": false, "resolution": "resolved" }
```

**Dynamic** — a POS screen with the amount and an invoice reference:

```
00020101021226290015tz.go.bot.tanqr01067788995303834540450005802TZ5916MAMA NTILIE CAFE6013DAR ES SALAAM62130509INV-009316304F4A1
```

```json
{ "payNumber": "778899", "merchantName": "MAMA NTILIE CAFE",
  "amountTzs": 5000, "dynamic": true, "reference": "INV-00931",
  "resolution": "resolved" }
```

To exercise your error handling, change any single character in the middle of either string. The checksum will no longer match its contents and you'll get `checksum_failed` — which is exactly what a tampered sticker produces, so it's worth seeing what your UI does with it.

Don't hand-write your own payloads. Every field carries its own length and the whole thing carries a checksum, so a hand-built string is almost always subtly wrong, and a wrong one teaches you nothing about your integration.

---

## Frequently confused

**"Do we need a different API for TANQR?"** No. One endpoint to read the code, then the ordinary spend endpoints.

**"Do we need TANQR enabled on our account?"** No. If `/v1/spend` works for you, QR works for you.

**"Does it work across banks and networks?"** Yes. This is live in production today: the NEDApay app runs on these same APIs, and scanning and paying a Lipa Namba works across banks and across every mobile network. You are not the first integration of this flow.

**"Can we skip the lookup and parse the QR ourselves?"** You can, and we publish enough here for you to try. We would rather you didn't: the merchant identifier's position is scheme-defined, so a parser that works on the codes you have on your desk can quietly mis-read a different acquirer's and pay the wrong till. The lookup confirms the till against the acquirer's register before it hands it to you; a local parser cannot.

**"What if the customer has no nTZS?"** Same as any spend — fund the wallet first. QR changes nothing about funding.

---

## Questions

API behaviour → NEDA Labs engineering. Ask us for a valid sample QR payload before you start; it will save you an afternoon.
