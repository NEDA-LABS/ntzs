'use client'

import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { WithdrawForm } from '../withdraw/WithdrawForm'

interface WithdrawInlineProps {
  userPhone?: string | null
}

export function WithdrawInline({ userPhone }: WithdrawInlineProps) {
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('wallet:openWithdraw', onOpen)
    return () => window.removeEventListener('wallet:openWithdraw', onOpen)
  }, [])

  function handleClose() {
    setOpen(false)
  }

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={handleClose}
          />

          <motion.div
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
          >
            <div className="w-full max-w-lg rounded-[28px] border border-border/40 bg-card/90 p-6 shadow-[0_30px_90px_rgba(3,7,18,0.4)] backdrop-blur-2xl" role="dialog" aria-modal="true">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-base font-bold text-foreground">Withdraw TZS</h2>
              <button type="button" onClick={handleClose} className="rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-background/40 hover:text-foreground">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <WithdrawForm userPhone={userPhone} />
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
