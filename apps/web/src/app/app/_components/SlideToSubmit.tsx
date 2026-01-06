'use client'

import { useEffect, useMemo, useRef, useState } from 'react'

import { IconChevronRight } from '@/app/app/_components/icons'

export function SlideToSubmit({ label }: { label: string }) {
  const trackRef = useRef<HTMLDivElement | null>(null)
  const knobRef = useRef<HTMLButtonElement | null>(null)

  const [dragging, setDragging] = useState(false)
  const [progress, setProgress] = useState(0)

  const threshold = 0.96

  const knobStyle = useMemo(() => {
    return {
      transform: `translateX(${progress * 100}%)`,
    }
  }, [progress])

  useEffect(() => {
    if (!dragging) return

    const handleMove = (e: PointerEvent) => {
      const track = trackRef.current
      const knob = knobRef.current
      if (!track || !knob) return

      const trackRect = track.getBoundingClientRect()
      const knobRect = knob.getBoundingClientRect()
      const knobWidth = knobRect.width

      const maxX = trackRect.width - knobWidth - 8
      const x = Math.min(Math.max(e.clientX - trackRect.left - knobWidth / 2, 0), maxX)
      setProgress(maxX <= 0 ? 0 : x / maxX)
    }

    const handleUp = () => {
      setDragging(false)
      setProgress((p) => {
        const done = p >= threshold
        if (!done) return 0

        const track = trackRef.current
        const form = track?.closest('form') as HTMLFormElement | null
        if (form) {
          const isValid = form.reportValidity()
          if (isValid) {
            form.requestSubmit()
            return 1
          }
        }

        return 0
      })
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)

    return () => {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
    }
  }, [dragging])

  return (
    <div
      ref={trackRef}
      className="relative h-14 w-full select-none overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04] backdrop-blur-xl"
    >
      <div className="pointer-events-none absolute inset-0 rounded-2xl bg-[radial-gradient(circle_at_20%_0%,rgba(121,40,202,0.18),transparent_55%),radial-gradient(circle_at_80%_100%,rgba(0,112,243,0.12),transparent_55%)]" />

      <div
        className="pointer-events-none absolute left-0 top-0 h-full bg-white/10"
        style={{ width: `calc(${Math.min(progress, 1) * 100}% + 3.25rem)` }}
        aria-hidden="true"
      />

      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <span className="text-sm font-semibold text-white/80">{label}</span>
      </div>

      <button
        ref={knobRef}
        type="button"
        aria-label={label}
        onPointerDown={(e) => {
          e.preventDefault()
          setDragging(true)
        }}
        style={knobStyle}
        className={
          "absolute left-1 top-1 z-10 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-white text-black shadow-sm transition-[transform] " +
          (dragging ? 'cursor-grabbing' : 'cursor-grab')
        }
      >
        <IconChevronRight className="h-5 w-5" />
      </button>
    </div>
  )
}
