/**
 * API Infrastructure Test Script
 * Tests wallet provisioning, transfers, and error handling
 */

const BASE_URL = process.env.NTZS_API_URL || 'https://www.ntzs.co.tz'
const API_KEY = process.env.NTZS_API_KEY || ''

interface TestResult {
  test: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  message?: string
  details?: unknown
}

const results: TestResult[] = []

async function testEndpoint(
  name: string,
  method: string,
  path: string,
  body?: unknown,
  expectedStatus?: number
): Promise<{ ok: boolean; status: number; data: unknown }> {
  try {
    const response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    })

    const data = await response.json()
    const ok = expectedStatus ? response.status === expectedStatus : response.ok

    results.push({
      test: name,
      status: ok ? 'PASS' : 'FAIL',
      message: ok ? `${method} ${path} returned ${response.status}` : `Expected ${expectedStatus}, got ${response.status}`,
      details: data,
    })

    return { ok, status: response.status, data }
  } catch (err) {
    results.push({
      test: name,
      status: 'FAIL',
      message: err instanceof Error ? err.message : String(err),
    })
    return { ok: false, status: 0, data: null }
  }
}

async function runTests() {
  console.log('Starting nTZS API Infrastructure Tests...\n')
  console.log(`Base URL: ${BASE_URL}`)
  console.log(`API Key: ${API_KEY ? '***' + API_KEY.slice(-4) : 'NOT SET'}\n`)

  if (!API_KEY) {
    console.error('ERROR: NTZS_API_KEY environment variable not set')
    console.log('Usage: NTZS_API_KEY=your-key npx tsx test-api.ts')
    process.exit(1)
  }

  // Test 1: Create User
  console.log('Test 1: Creating test user...')
  const userResult = await testEndpoint(
    'Create User',
    'POST',
    '/api/v1/users',
    { email: `test-${Date.now()}@example.com`, name: 'Test User' },
    201
  )

  if (!userResult.ok) {
    console.error('Failed to create user. Stopping tests.')
    printResults()
    process.exit(1)
  }

  const userId = (userResult.data as { id: string }).id
  console.log(`Created user: ${userId}\n`)

  // Test 2: Get User Profile
  console.log('Test 2: Fetching user profile...')
  const profileResult = await testEndpoint(
    'Get User Profile',
    'GET',
    `/api/v1/users/${userId}`,
    undefined,
    200
  )

  const user = profileResult.data as { walletAddress?: string; balanceTzs?: number }
  console.log(`Wallet: ${user.walletAddress || 'pending'}`)
  console.log(`Balance: ${user.balanceTzs || 0} TZS\n`)

  // Test 3: Check Wallet Provisioning
  console.log('Test 3: Checking wallet provisioning status...')
  const isProvisioned = user.walletAddress && !user.walletAddress.startsWith('0x_pending_')
  results.push({
    test: 'Wallet Provisioning',
    status: isProvisioned ? 'PASS' : 'SKIP',
    message: isProvisioned
      ? `Wallet provisioned: ${user.walletAddress}`
      : 'Wallet still pending (this is normal for async provisioning)',
  })

  // Test 4: Test Transfer Error Handling (insufficient balance)
  console.log('\nTest 4: Testing transfer error handling...')
  const user2Result = await testEndpoint(
    'Create Second User',
    'POST',
    '/api/v1/users',
    { email: `test2-${Date.now()}@example.com`, name: 'Test User 2' },
    201
  )

  if (user2Result.ok) {
    const userId2 = (user2Result.data as { id: string }).id
    
    // Try transfer with insufficient balance (should fail with specific error)
    const transferResult = await testEndpoint(
      'Transfer with Insufficient Balance',
      'POST',
      '/api/v1/transfers',
      { fromUserId: userId, toUserId: userId2, amountTzs: 100 },
      400
    )

    const transferError = transferResult.data as { error?: string; message?: string }
    const hasStructuredError = transferError.error && transferError.message
    
    results.push({
      test: 'Structured Error Response',
      status: hasStructuredError ? 'PASS' : 'FAIL',
      message: hasStructuredError
        ? `Error code: ${transferError.error}`
        : 'Error response missing error code or message',
      details: transferError,
    })
  }

  // Test 5: Test Invalid Requests
  console.log('\nTest 5: Testing validation...')
  
  await testEndpoint(
    'Transfer Missing Fields',
    'POST',
    '/api/v1/transfers',
    { fromUserId: userId },
    400
  )

  await testEndpoint(
    'Transfer Negative Amount',
    'POST',
    '/api/v1/transfers',
    { fromUserId: userId, toUserId: 'test', amountTzs: -10 },
    400
  )

  await testEndpoint(
    'Transfer to Self',
    'POST',
    '/api/v1/transfers',
    { fromUserId: userId, toUserId: userId, amountTzs: 10 },
    400
  )

  await testEndpoint(
    'User Not Found',
    'POST',
    '/api/v1/transfers',
    { fromUserId: userId, toUserId: 'nonexistent', amountTzs: 10 },
    404
  )

  // Print Results
  console.log('\n' + '='.repeat(80))
  printResults()
}

function printResults() {
  console.log('\nTest Results Summary:')
  console.log('='.repeat(80))

  const passed = results.filter(r => r.status === 'PASS').length
  const failed = results.filter(r => r.status === 'FAIL').length
  const skipped = results.filter(r => r.status === 'SKIP').length

  results.forEach(result => {
    const icon = result.status === 'PASS' ? '✓' : result.status === 'FAIL' ? '✗' : '○'
    console.log(`${icon} ${result.test}: ${result.status}`)
    if (result.message) {
      console.log(`  ${result.message}`)
    }
  })

  console.log('\n' + '='.repeat(80))
  console.log(`Total: ${results.length} | Passed: ${passed} | Failed: ${failed} | Skipped: ${skipped}`)
  console.log('='.repeat(80))

  if (failed > 0) {
    console.log('\nFailed tests detected. Review details above.')
    process.exit(1)
  } else {
    console.log('\nAll tests passed!')
  }
}

runTests().catch(err => {
  console.error('Test suite failed:', err)
  process.exit(1)
})
