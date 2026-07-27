'use client'

import { useRef, useEffect, ReactNode } from 'react'
import {
  motion,
  useScroll,
  useSpring,
  useTransform,
  useMotionTemplate,
  useReducedMotion,
} from 'framer-motion'

interface ScrollExpandSectionProps {
  videoSrc: string
  children: ReactNode
  overlayClassName?: string
  videoEndTime?: number
}

export default function ScrollExpandSection({
  videoSrc,
  children,
  overlayClassName = 'bg-gradient-to-t from-black/90 via-black/50 to-black/70',
  videoEndTime,
}: ScrollExpandSectionProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const prefersReducedMotion = useReducedMotion()

  useEffect(() => {
    const video = videoRef.current
    if (!video || !videoEndTime) return
    const handleTimeUpdate = () => {
      if (video.currentTime >= videoEndTime) {
        video.currentTime = 0
      }
    }
    video.addEventListener('timeupdate', handleTimeUpdate)
    return () => video.removeEventListener('timeupdate', handleTimeUpdate)
  }, [videoEndTime])

  // Pause the video while its section is off screen so the page isn't
  // decoding five videos at once mid-scroll. The element keeps autoPlay, so
  // if this observer never runs the videos simply play as they always did.
  useEffect(() => {
    const video = videoRef.current
    const container = containerRef.current
    if (!video || !container) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) video.play().catch(() => {})
        else video.pause()
      },
      { rootMargin: '25% 0px' }
    )
    io.observe(container)
    return () => io.disconnect()
  }, [])

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  })

  // Wheel/trackpad scrolling arrives in discrete jumps; a spring interpolates
  // between them so the expansion glides instead of stepping.
  const spring = useSpring(scrollYProgress, {
    stiffness: 110,
    damping: 24,
    mass: 0.4,
    restDelta: 0.001,
  })
  const progress = prefersReducedMotion ? scrollYProgress : spring

  // The card is a full-screen layer revealed via clip-path (paint-only) —
  // animating width/height here forces layout + video resize every frame.
  const insetX = useTransform(progress, [0, 0.6], [30, 0])
  const insetY = useTransform(progress, [0, 0.6], [25, 0])
  const radius = useTransform(progress, [0, 0.55], [28, 0])
  const clipPath = useMotionTemplate`inset(${insetY}% ${insetX}% ${insetY}% ${insetX}% round ${radius}px)`

  // Content fades and rises in after the card has expanded
  const contentOpacity = useTransform(progress, [0.5, 0.85], [0, 1])
  const contentY = useTransform(progress, [0.5, 0.85], [28, 0])

  return (
    <div ref={containerRef} className="relative" style={{ height: '250vh' }}>
      <div className="sticky top-0 h-screen overflow-hidden bg-black">
        <motion.div
          style={{ clipPath, willChange: 'clip-path' }}
          className="absolute inset-0 overflow-hidden"
        >
          {/* Video background */}
          <video
            ref={videoRef}
            autoPlay
            loop={!videoEndTime}
            muted
            playsInline
            preload="metadata"
            className="absolute inset-0 h-full w-full object-cover"
          >
            <source src={videoSrc} type="video/mp4" />
          </video>

          {/* Overlay */}
          <div className={`absolute inset-0 ${overlayClassName}`} />

          {/* Content fades in after expand */}
          <motion.div
            style={{ opacity: contentOpacity, y: prefersReducedMotion ? 0 : contentY }}
            className="relative z-10 flex h-full items-center"
          >
            {children}
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
