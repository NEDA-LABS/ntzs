import { SignJWT, importJWK, type JWK } from 'jose'

// Store keys as JWK in environment variables
// Generate once and store permanently
const CDP_JWT_PRIVATE_KEY_JWK = process.env.CDP_JWT_PRIVATE_KEY_JWK
const CDP_JWT_PUBLIC_KEY_JWK = process.env.CDP_JWT_PUBLIC_KEY_JWK
const CDP_JWT_KID = process.env.CDP_JWT_KID || 'cdp-key-1'

let cachedPrivateKey: CryptoKey | null = null
let cachedPublicJwk: JWK | null = null

export async function getPrivateKey(): Promise<CryptoKey> {
  if (cachedPrivateKey) return cachedPrivateKey

  // Fail closed. There is deliberately no built-in key: a missing env var must
  // NOT fall back to a shared/committed private key, because this key signs the
  // JWTs that authenticate users to their CDP embedded wallets — anyone holding
  // it could forge a token for any user. Callers wrap this and return 500.
  if (!CDP_JWT_PRIVATE_KEY_JWK) {
    throw new Error('CDP_JWT_PRIVATE_KEY_JWK is not configured')
  }

  cachedPrivateKey = await importJWK(JSON.parse(CDP_JWT_PRIVATE_KEY_JWK), 'ES256') as CryptoKey
  return cachedPrivateKey
}

export async function getPublicKeyJwk(): Promise<JWK> {
  if (cachedPublicJwk) return cachedPublicJwk

  // Fail closed — the JWKS must advertise the real signing key, never a default.
  if (!CDP_JWT_PUBLIC_KEY_JWK) {
    throw new Error('CDP_JWT_PUBLIC_KEY_JWK is not configured')
  }

  cachedPublicJwk = JSON.parse(CDP_JWT_PUBLIC_KEY_JWK) as JWK
  return cachedPublicJwk
}

export async function getPublicJWKS() {
  const jwk = await getPublicKeyJwk()
  
  return {
    keys: [
      {
        ...jwk,
        kid: CDP_JWT_KID,
        alg: 'ES256',
        use: 'sig',
      },
    ],
  }
}

export interface CDPTokenPayload {
  sub: string
  email?: string
  name?: string
}

export async function signCDPToken(payload: CDPTokenPayload, issuer: string, audience: string) {
  const privateKey = await getPrivateKey()
  
  const jwt = await new SignJWT({
    ...payload,
  })
    .setProtectedHeader({ alg: 'ES256', kid: CDP_JWT_KID })
    .setIssuedAt()
    .setIssuer(issuer)
    .setAudience(audience)
    .setSubject(payload.sub)
    .setExpirationTime('15m') // Short-lived token
    .sign(privateKey)

  return jwt
}
