import { describe, it, expect } from 'vitest'

import { parseCsv, mapAzamCsv, successRows } from './azampay-csv'

describe('parseCsv', () => {
  it('parses plain rows and skips blank lines', () => {
    expect(parseCsv('a,b,c\n1,2,3\n\n4,5,6\n')).toEqual([
      ['a', 'b', 'c'],
      ['1', '2', '3'],
      ['4', '5', '6'],
    ])
  })

  it('handles quoted commas, escaped quotes and CRLF', () => {
    const text = 'id,desc\r\n"T1","User didn\'t enter the PIN, timeout"\r\n"T2","said ""no"""\r\n'
    expect(parseCsv(text)).toEqual([
      ['id', 'desc'],
      ['T1', "User didn't enter the PIN, timeout"],
      ['T2', 'said "no"'],
    ])
  })
})

describe('mapAzamCsv (dashboard export headers)', () => {
  const HEADER =
    'Date,Time,Amount,Funding Source,Transaction ID,Operator Ref No,Service Name,Merchant Ref No,Reference No,Customer No,Customer Name,Status,Request Type,Failure Description'

  it('maps the dashboard columns and dedupes by transaction id', () => {
    const csv = [
      HEADER,
      '07/18/2026,01:13:00 PM,"10,000.00",Airtel Money,019f74b7069d,MP260718.1314.K70687,NEDA LABS,24639804-9c44-4d41,,255699899636,,SUCCESS,Payment,',
      '07/18/2026,01:13:00 PM,"10,000.00",Airtel Money,019f74b7069d,MP260718.1314.K70687,NEDA LABS,24639804-9c44-4d41,,255699899636,,SUCCESS,Payment,',
      '07/18/2026,01:13:51 PM,"10,000.00",Airtel Money,019f74b7cd8b,NA,NEDA LABS,fb92f818-1dbc,,255699899636,,FAILURE,Payment,"User didn\'t enter the PIN"',
    ].join('\n')

    const rows = mapAzamCsv(parseCsv(csv))
    expect(rows).not.toBeNull()
    expect(rows!).toHaveLength(2)
    expect(rows![0]).toEqual({
      transactionId: '019f74b7069d',
      merchantRef: '24639804-9c44-4d41',
      status: 'SUCCESS',
      amountTzs: 10000,
      customerNo: '255699899636',
      date: '07/18/2026',
    })
  })

  it('returns null when required columns are missing', () => {
    expect(mapAzamCsv(parseCsv('foo,bar\n1,2'))).toBeNull()
  })

  it('successRows filters to AzamPay-successful payments only', () => {
    const rows = mapAzamCsv(
      parseCsv(
        [
          HEADER,
          'd,t,100,src,T1,,svc,M1,,c,,SUCCESS,Payment,',
          'd,t,100,src,T2,,svc,M2,,c,,PENDING,Payment,',
          'd,t,100,src,T3,,svc,M3,,c,,FAILURE,Payment,x',
        ].join('\n')
      )
    )!
    expect(successRows(rows).map((r) => r.transactionId)).toEqual(['T1'])
  })
})
