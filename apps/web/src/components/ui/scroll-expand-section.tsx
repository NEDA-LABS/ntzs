'use client'

import { useRef, useEffect, ReactNode } from 'react'
import { motion, useScroll, useTransform } from 'framer-motion'

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

  const { scrollYProgress } = useScroll({
    target: containerRef,
    offset: ['start start', 'end end'],
  })

  // Card starts small (40%) with heavy rounding, expands to full screen with smooth easing
  const width = useTransform(scrollYProgress, [0, 0.6], ['40%', '100%'])
  const height = useTransform(scrollYProgress, [0, 0.6], ['50vh', '100vh'])
  const borderRadius = useTransform(scrollYProgress, [0, 0.55], ['28px', '0px'])
  const scale = useTransform(scrollYProgress, [0, 0.6], [0.92, 1])
  // Content fades in smoothly after the card has expanded
  const contentOpacity = useTransform(scrollYProgress, [0.5, 0.85], [0, 1])

  return (
    <div ref={containerRef} className="relative" style={{ height: '250vh' }}>
      <div className="sticky top-0 flex h-screen items-center justify-center overflow-hidden bg-black">
        <motion.div
          style={{ width, height, borderRadius, scale }}
          className="relative overflow-hidden"
          transition={{
            type: 'spring',
            stiffness: 80,
            damping: 20,
            mass: 0.8
          }}
        >
          {/* Video background */}
          <video
            ref={videoRef}
            autoPlay
            loop={!videoEndTime}
            muted
            playsInline
            className="absolute inset-0 h-full w-full object-cover"
          >
            <source src={videoSrc} type="video/mp4" />
          </video>

          {/* Overlay */}
          <div className={`absolute inset-0 ${overlayClassName}`} />

          {/* Content fades in after expand */}
          <motion.div
            style={{ opacity: contentOpacity }}
            className="relative z-10 flex h-full items-center"
            transition={{
              type: 'spring',
              stiffness: 60,
              damping: 25,
              mass: 0.5
            }}
          >
            {children}
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}
