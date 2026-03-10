'use client'

import { motion } from 'framer-motion'

interface CodeRevealTextProps {
  text: string
  className?: string
  delay?: number
}

export function CodeRevealText({ text, className = '', delay = 0 }: CodeRevealTextProps) {
  return (
    <motion.span
      className={`inline-block ${className}`}
      initial={{ clipPath: 'inset(100% 0 0 0)', opacity: 0 }}
      animate={{
        clipPath: ['inset(100% 0 0 0)', 'inset(0% 0 0 0)', 'inset(0% 0 0 0)', 'inset(0% 0 100% 0)'],
        opacity: [0, 1, 1, 0]
      }}
      transition={{
        duration: 6,
        delay,
        times: [0, 0.3, 0.7, 1],
        repeat: Infinity,
        repeatDelay: 0.5,
        ease: 'easeInOut'
      }}
    >
      {text}
    </motion.span>
  )
}
