import postgres from 'postgres';
import { config } from 'dotenv';

config({ path: '.env.local' });

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function check() {
  // Get all deposits with status 'minted'
  const minted = await sql`
    SELECT id, amount_tzs, status, psp_reference, created_at 
    FROM deposit_requests 
    WHERE status = 'minted'
    ORDER BY created_at
  `;
  
  console.log('=== MINTED DEPOSITS ===');
  let total = 0;
  for (const d of minted) {
    console.log(`${d.id.slice(0,8)}... | ${d.amount_tzs} TZS | ${d.psp_reference || 'no-ref'} | ${d.created_at}`);
    total += Number(d.amount_tzs);
  }
  console.log(`\nTotal from minted deposits: ${total} TZS`);
  console.log(`Count: ${minted.length}`);
  
  // Get all deposits by status
  const byStatus = await sql`
    SELECT status, COUNT(*) as count, SUM(amount_tzs) as total
    FROM deposit_requests
    GROUP BY status
    ORDER BY status
  `;
  
  console.log('\n=== DEPOSITS BY STATUS ===');
  for (const s of byStatus) {
    console.log(`${s.status}: ${s.count} deposits, ${s.total} TZS`);
  }
  
  // Get all mint transactions
  const txs = await sql`
    SELECT mt.tx_hash, mt.status, dr.amount_tzs, dr.id as deposit_id
    FROM mint_transactions mt
    JOIN deposit_requests dr ON mt.deposit_request_id = dr.id
    ORDER BY mt.created_at
  `;
  
  console.log('\n=== MINT TRANSACTIONS ===');
  for (const t of txs) {
    console.log(`${t.deposit_id.slice(0,8)}... | ${t.amount_tzs} TZS | ${t.status} | tx: ${t.tx_hash ? t.tx_hash.slice(0,40) + '...' : 'no-hash'}`);
  }
  
  await sql.end();
}

check().catch(console.error);
