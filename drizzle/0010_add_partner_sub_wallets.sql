-- Migration: Add partner sub-wallets support
-- Sub-wallets are partner-controlled wallets derived from the treasury HD path
-- at indices 1+ (treasury is always index 0: m/44'/8453'/1'/0/0)

ALTER TABLE partners
  ADD COLUMN next_sub_wallet_index integer NOT NULL DEFAULT 1;

CREATE TABLE partner_sub_wallets (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid        NOT NULL REFERENCES partners(id) ON DELETE CASCADE,
  label       text        NOT NULL,
  address     text        NOT NULL,
  wallet_index integer    NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX partner_sub_wallets_partner_id_idx ON partner_sub_wallets(partner_id);
