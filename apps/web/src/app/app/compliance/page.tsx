import Link from 'next/link'

import { requireRole } from '@/lib/auth/rbac'
import { NTZS_CONTRACT_ADDRESS_BASE } from '@/lib/env'
import { ExportReportButton } from '../oversight/_components/ExportReportButton'

const CONTRACT_ADDRESS = NTZS_CONTRACT_ADDRESS_BASE

function GlassCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="group relative overflow-hidden rounded-2xl border border-white/10 bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.05)] backdrop-blur-xl">
      <div className="absolute -left-24 -top-24 h-56 w-56 rounded-full bg-white/5 blur-3xl transition-opacity group-hover:opacity-80" />
      <div className="relative">
        <div className="text-sm font-medium text-white/70">{title}</div>
        <div className="mt-2 text-base leading-6 text-white/90">{description}</div>
      </div>
    </div>
  )
}

export default async function ComplianceDashboard() {
  await requireRole('platform_compliance')

  return (
    <div className="relative min-h-[calc(100vh-2rem)] overflow-hidden bg-black text-white">
      <div className="pointer-events-none absolute inset-0 opacity-70">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,rgba(121,40,202,0.25),transparent_40%),radial-gradient(circle_at_80%_30%,rgba(0,112,243,0.25),transparent_45%),radial-gradient(circle_at_45%_90%,rgba(16,185,129,0.18),transparent_45%)]" />
        <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:48px_48px]" />
      </div>

      <main className="relative z-10 mx-auto w-full max-w-6xl px-6 pb-20 pt-8">
        <section className="grid items-center gap-10 md:grid-cols-2 md:gap-12">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 backdrop-blur-lg">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              Compliance and transparency overview
            </div>

            <h1 className="mt-5 text-4xl font-semibold leading-[1.05] tracking-tight md:text-6xl">
              Compliance built for regulators.
            </h1>

            <p className="mt-5 max-w-xl text-base leading-7 text-white/70 md:text-lg">
              This page provides a concise overview of how nTZS maintains transparency, policy controls,
              and auditability. For detailed operational monitoring, use the Oversight Dashboard.
            </p>

            <div className="mt-7 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/app/oversight"
                className="inline-flex h-12 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90"
              >
                Open Oversight Dashboard
              </Link>
              <div className="inline-flex h-12 items-center justify-center rounded-full border border-white/15 bg-white/5 px-4 text-sm text-white/85 backdrop-blur-lg transition-colors hover:bg-white/10">
                <ExportReportButton />
              </div>
            </div>

            <div className="mt-4 flex flex-wrap gap-3 text-xs text-white/60">
              <a
                className="hover:text-white"
                href={`https://basescan.org/address/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Verify contract
              </a>
              <span className="text-white/30">/</span>
              <a
                className="hover:text-white"
                href={`https://basescan.org/token/${CONTRACT_ADDRESS}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                Verify token
              </a>
            </div>
          </div>

          <div className="relative">
            <div className="absolute -inset-6 rounded-[2rem] bg-gradient-to-tr from-white/10 via-white/0 to-white/10 blur-2xl" />
            <div className="relative overflow-hidden rounded-[28px] border border-white/10 bg-white/5 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl">
              <div className="grid gap-5 p-6 md:p-7">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">What we provide</div>
                  <div className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70">
                    Compliance
                  </div>
                </div>

                <div className="grid gap-3">
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-sm font-semibold">Policy controls</div>
                    <p className="mt-2 text-sm text-white/70">
                      Issuance follows structured approval flows with clear operational guardrails.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-sm font-semibold">Transparency reporting</div>
                    <p className="mt-2 text-sm text-white/70">
                      Exportable reserves reporting designed for external publication and review.
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-black/20 p-4">
                    <div className="text-sm font-semibold">Auditability</div>
                    <p className="mt-2 text-sm text-white/70">
                      Full traceability across deposits, approvals, issuance, and on-chain verification.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mt-16">
          <div className="flex items-end justify-between gap-6">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">A clear compliance posture</h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70 md:text-base">
                Designed for regulator review: transparency, controls, and a strong audit trail.
              </p>
            </div>
          </div>

          <div className="mt-10 grid gap-5 md:grid-cols-3">
            <GlassCard
              title="Governance"
              description="Defined roles and access controls support responsible issuance and operational separation of duties."
            />
            <GlassCard
              title="Assurance-ready"
              description="Reserves reporting is structured for review and periodic external assurance workflows."
            />
            <GlassCard
              title="On-chain transparency"
              description="Supply and transaction activity can be independently verified via public block explorers."
            />
          </div>
        </section>

        <section className="mt-16">
          <div className="rounded-[28px] border border-white/10 bg-white/5 p-6 shadow-[0_0_0_1px_rgba(255,255,255,0.06)] backdrop-blur-xl md:p-10">
            <div className="grid gap-8 md:grid-cols-2 md:items-center">
              <div>
                <h2 className="text-2xl font-semibold tracking-tight md:text-3xl">Need operational detail?</h2>
                <p className="mt-3 text-sm leading-6 text-white/70 md:text-base">
                  The Oversight Dashboard provides the detailed activity view: deposits, issuance controls, audit trail,
                  and smart contract links.
                </p>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:justify-end">
                <div className="inline-flex h-11 items-center justify-center rounded-full border border-white/15 bg-white/5 px-6 text-sm text-white/80 backdrop-blur-lg transition-colors hover:bg-white/10">
                  <ExportReportButton />
                </div>
                <Link
                  href="/app/oversight"
                  className="inline-flex h-11 items-center justify-center rounded-full bg-white px-6 text-sm font-semibold text-black transition-colors hover:bg-white/90"
                >
                  Open Oversight
                </Link>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  )
}
