// Compatibility shim — module moved to the shared package (plan Phase 0b).
// Webhook handlers import '@/lib/psp/snippe' for payload shapes + signature
// verification; keep this path stable.
export * from '@ntzs/psp/snippe'
