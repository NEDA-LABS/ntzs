"use client"

import { useState, useEffect } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, ExternalLink, RefreshCw, Maximize2 } from "lucide-react"

interface WebViewModalProps {
  href: string
  title: string
  sourceLabel: string
  isOpen: boolean
  onClose: () => void
}

export function WebViewModal({ href, title, sourceLabel, isOpen, onClose }: WebViewModalProps) {
  const [loading, setLoading] = useState(true)
  const [blocked, setBlocked] = useState(false)

  useEffect(() => {
    if (isOpen) {
      setLoading(true)
      setBlocked(false)
    }
  }, [isOpen, href])

  // Lock body scroll when open
  useEffect(() => {
    if (isOpen) {
      document.body.style.overflow = "hidden"
    } else {
      document.body.style.overflow = ""
    }
    return () => { document.body.style.overflow = "" }
  }, [isOpen])

  const handleLoad = () => setLoading(false)
  const handleError = () => { setLoading(false); setBlocked(true) }

  // Most news sites block iframes — detect via a timeout as fallback
  useEffect(() => {
    if (!isOpen) return
    const t = setTimeout(() => {
      setBlocked(true)
      setLoading(false)
    }, 6000)
    return () => clearTimeout(t)
  }, [isOpen, href])

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
          />

          {/* Sheet */}
          <motion.div
            className="fixed inset-x-0 bottom-0 z-50 flex flex-col rounded-t-3xl bg-[#0d0d14] ring-1 ring-white/[0.08] md:inset-x-auto md:left-1/2 md:-translate-x-1/2 md:bottom-6 md:w-[720px] md:rounded-3xl"
            style={{ height: "88dvh", maxHeight: "88dvh" }}
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", stiffness: 400, damping: 40 }}
          >
            {/* Drag handle */}
            <div className="flex justify-center pt-3 pb-1">
              <div className="h-1 w-10 rounded-full bg-white/[0.12]" />
            </div>

            {/* Header */}
            <div className="flex items-center gap-3 border-b border-white/[0.06] px-4 py-3">
              <div className="flex min-w-0 flex-1 flex-col">
                <p className="truncate text-sm font-semibold text-white">{title}</p>
                <p className="text-[11px] text-zinc-600">{sourceLabel}</p>
              </div>
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-zinc-400 hover:bg-white/[0.1] hover:text-white transition-colors"
                aria-label="Open in browser"
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={onClose}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.06] text-zinc-400 hover:bg-white/[0.1] hover:text-white transition-colors"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Content */}
            <div className="relative flex-1 overflow-hidden rounded-b-3xl">
              {/* Loading spinner */}
              {loading && !blocked && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[#0d0d14]">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                  >
                    <RefreshCw className="h-6 w-6 text-zinc-600" />
                  </motion.div>
                  <p className="text-xs text-zinc-600">Loading article...</p>
                </div>
              )}

              {/* Blocked fallback */}
              {blocked && (
                <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/[0.04]">
                    <Maximize2 className="h-6 w-6 text-zinc-500" />
                  </div>
                  <div className="space-y-1.5">
                    <p className="text-sm font-semibold text-white">Open in browser to read</p>
                    <p className="text-xs leading-relaxed text-zinc-500">
                      {sourceLabel} prevents in-app viewing. Tap below to open the article in your browser.
                    </p>
                  </div>
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 rounded-xl bg-blue-500/10 px-5 py-2.5 text-sm font-semibold text-blue-400 ring-1 ring-blue-500/20 hover:bg-blue-500/20 transition-colors"
                  >
                    <ExternalLink className="h-4 w-4" />
                    Open article
                  </a>
                </div>
              )}

              {/* iframe */}
              {!blocked && (
                <iframe
                  key={href}
                  src={href}
                  title={title}
                  className="h-full w-full border-0 bg-white"
                  onLoad={handleLoad}
                  onError={handleError}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                />
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  )
}
