import { eq } from 'drizzle-orm'
import { notFound } from 'next/navigation'

import { getDb } from '@/lib/db'
import { users } from '@ntzs/db'

import { PayForm } from './PayForm'

interface Props {
  params: Promise<{ alias: string }>
  searchParams: Promise<{ amount?: string; desc?: string; fixed?: string }>
}

export default async function PayPage({ params, searchParams }: Props) {
  const { alias } = await params
  const { amount, desc, fixed } = await searchParams
  const { db } = getDb()

  const recipient = await db.query.users.findFirst({
    where: eq(users.payAlias, alias.toLowerCase()),
  })

  if (!recipient) {
    notFound()
  }

  const displayName = recipient.payAlias ?? recipient.name ?? recipient.email.split('@')[0]

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#09090b] p-4">
      <div className="w-full max-w-md">
        {/* Header */}
        <div className="mb-6 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
            <img src="/ntzs-logo.png" alt="nTZS" className="h-8 w-8 object-contain" />
          </div>
          {desc ? (
            <>
              <p className="mt-4 text-sm text-zinc-400">Payment for</p>
              <p className="mt-0.5 text-base font-semibold text-white">{desc}</p>
              <p className="mt-1 text-xs text-zinc-500">to @{displayName}</p>
            </>
          ) : (
            <>
              <p className="mt-4 text-sm text-zinc-400">Pay to</p>
              <h1 className="mt-1 text-2xl font-bold text-white">@{displayName}</h1>
            </>
          )}
        </div>

        {/* Form Card */}
        <div className="rounded-3xl border border-white/10 bg-white/[0.04] p-6 backdrop-blur-xl">
          <PayForm
            alias={alias}
            displayName={displayName}
            initialAmount={amount}
            initialDescription={desc}
            isFixed={fixed === '1'}
          />
        </div>

        {/* Footer */}
        <p className="mt-6 text-center text-xs text-zinc-600">
          Powered by nTZS · Secure mobile payments
        </p>
      </div>
    </div>
  )
}
