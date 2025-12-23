import { neonAuthMiddleware } from '@neondatabase/neon-js/auth/next'

export default neonAuthMiddleware({
  loginUrl: '/auth/sign-in',
})

export const config = {
  matcher: ['/account/:path*', '/app/:path*', '/ops/:path*', '/backstage/:path*'],
}
