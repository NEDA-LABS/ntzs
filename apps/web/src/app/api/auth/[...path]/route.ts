import { authApiHandler } from '@neondatabase/auth/next/server'

export const dynamic = 'force-dynamic'

// Defer handler initialisation to first request — authApiHandler() reads
// NEON_AUTH_BASE_URL at call time, which throws during build-time module
// evaluation when the env var isn't available in worker processes.
type Handler = ReturnType<typeof authApiHandler>
let _handler: Handler | undefined
const h = (): Handler => (_handler ??= authApiHandler())

export const GET: Handler['GET'] = (...args) => h().GET(...args)
export const POST: Handler['POST'] = (...args) => h().POST(...args)
