-- Amount at or above which an LP action needs a second sign-off, whoever asks.
--
-- Role alone decided this before: an operator's action queued, an owner's ran
-- straight through. Institutions want the mirror of that — a value ceiling
-- their own owner cannot cross alone. NULL = no ceiling (role rules only).
ALTER TABLE lp_accounts ADD COLUMN IF NOT EXISTS approval_threshold_tzs bigint;

COMMENT ON COLUMN lp_accounts.approval_threshold_tzs IS
  'Withdrawals/cash-outs at or above this TZS amount require a second approver even for owners. NULL = role-based policy only.';
