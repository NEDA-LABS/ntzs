import 'dotenv/config'

import { sleep } from '@ntzs/shared'

async function main() {
  // Placeholder worker loop. We’ll replace this with:
  // - DB polling for mint_pending deposits
  // - limit checks (daily TZS cap)
  // - Base/BNB mint tx submission
  // - status updates + audit logs
  //
  // Keeping it simple for the first commit so the worker can run.
  // eslint-disable-next-line no-console
  console.log('[worker] started')

  // eslint-disable-next-line no-constant-condition
  while (true) {
    // eslint-disable-next-line no-console
    console.log('[worker] tick')
    await sleep(5000)
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[worker] fatal', err)
  process.exit(1)
})
