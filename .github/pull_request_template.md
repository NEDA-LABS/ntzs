## What & why

<!-- Describe the change and the motivation. Link the issue or finding. -->

## Security checklist

- [ ] No secrets, keys, or credentials added to code, tests, or fixtures
- [ ] Inputs validated at the API boundary (amounts finite & > 0, addresses/phones checked)
- [ ] Authorization enforced (correct role / tenant scope); no new IDOR
- [ ] Money-moving paths are idempotent and cap-enforced where applicable
- [ ] Fails closed on missing config/secrets (no dev-key or open fallback)
- [ ] `npm test --workspace apps/web` and `tsc --noEmit` pass locally

## High-risk area? (mint/burn, webhooks, cron, auth, keys, contracts)

- [ ] N/A
- [ ] Yes — added a regression test and requested a second (security) reviewer

<!-- Reference any assessment finding IDs this addresses (e.g. C1, H8). -->
