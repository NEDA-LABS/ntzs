"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight, Link, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { VoicePoweredOrb } from "@/components/ui/voice-powered-orb"

export interface TimelineItem {
  id: number
  title: string
  date: string
  content: string
  category: string
  icon: React.ElementType<{ size?: number }>
  relatedIds: number[]
  status: "completed" | "in-progress" | "pending"
  energy: number
  actionLabel?: string
  actionHref?: string
  accentColor?: "blue" | "violet" | "emerald"
}

interface RadialOrbitalTimelineProps {
  timelineData: TimelineItem[]
  onActionClick?: (item: TimelineItem) => void
  onOrbClick?: () => void
  isThinking?: boolean
  autoExpandId?: number | null
  orbCardContent?: React.ReactNode
  closeOrbTrigger?: number
}

const accentStyles = {
  blue: {
    ring: "border-blue-400/60",
    bg: "bg-blue-500/20 text-blue-300",
    bar: "from-blue-500 to-blue-400",
    iconBg: "from-blue-600 to-blue-400",
    glow: "shadow-blue-500/30",
  },
  violet: {
    ring: "border-violet-400/60",
    bg: "bg-violet-500/20 text-violet-300",
    bar: "from-violet-500 to-violet-400",
    iconBg: "from-violet-600 to-purple-400",
    glow: "shadow-violet-500/30",
  },
  emerald: {
    ring: "border-emerald-400/60",
    bg: "bg-emerald-500/20 text-emerald-300",
    bar: "from-emerald-500 to-emerald-400",
    iconBg: "from-emerald-600 to-emerald-400",
    glow: "shadow-emerald-500/30",
  },
}

/* ─── Orbital node (dock-style) ──────────────────────────────────────────── */

function OrbitalNode({
  item,
  isExpanded,
  isRelated,
  isPulsing,
  posX,
  posY,
  posZIndex,
  posOpacity,
  onToggle,
  onActionClick,
  timelineData,
  onRelatedClick,
}: {
  item: TimelineItem
  isExpanded: boolean
  isRelated: boolean
  isPulsing: boolean
  posX: number
  posY: number
  posZIndex: number
  posOpacity: number
  onToggle: () => void
  onActionClick?: (item: TimelineItem) => void
  timelineData: TimelineItem[]
  onRelatedClick: (id: number) => void
}) {
  const [isHovered, setIsHovered] = useState(false)
  const Icon = item.icon
  const accent = accentStyles[item.accentColor ?? "violet"]

  const getStatusLabel = (status: TimelineItem["status"]) => {
    if (status === "completed") return "ACTIVE"
    if (status === "in-progress") return "IN PROGRESS"
    return "PENDING"
  }

  return (
    <motion.div
      className="absolute cursor-pointer"
      animate={{
        x: posX,
        y: posY,
        opacity: isExpanded ? 1 : posOpacity,
        scale: isExpanded ? 1.1 : 1,
      }}
      transition={{
        type: "spring",
        stiffness: 120,
        damping: 20,
        mass: 0.8,
      }}
      style={{ zIndex: isExpanded ? 200 : posZIndex }}
      onClick={(e) => { e.stopPropagation(); onToggle() }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* ── Icon button (dock-style) ── */}
      <motion.div
        className="relative flex items-center justify-center"
        animate={{
          y: isHovered && !isExpanded ? -6 : 0,
        }}
        transition={{ type: "spring", stiffness: 400, damping: 17 }}
        whileTap={{ scale: 0.9 }}
      >
        {/* Glow ring for related/pulsing nodes */}
        <AnimatePresence>
          {(isPulsing || isRelated) && (
            <motion.div
              className={`absolute -inset-1.5 rounded-2xl border ${accent.ring}`}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: [0.4, 0.8, 0.4], scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ opacity: { repeat: Infinity, duration: 1.5 }, scale: { duration: 0.2 } }}
            />
          )}
        </AnimatePresence>

        {/* Icon container */}
        <motion.div
          className={`
            relative flex h-12 w-12 items-center justify-center rounded-2xl overflow-hidden
            shadow-lg transition-shadow duration-300
            ${isExpanded ? `shadow-xl ${accent.glow}` : "shadow-black/40"}
          `}
          animate={{
            scale: isExpanded ? 1.25 : isHovered ? 1.12 : 1,
          }}
          transition={{ type: "spring", stiffness: 400, damping: 17 }}
        >
          {/* Gradient background */}
          <div className={`absolute inset-0 bg-gradient-to-br ${accent.iconBg}`} />

          {/* Shine overlay */}
          <motion.div
            className="absolute inset-0 bg-gradient-to-br from-white/25 via-white/5 to-transparent rounded-2xl"
            animate={{ opacity: isHovered || isExpanded ? 0.5 : 0.15 }}
            transition={{ duration: 0.2 }}
          />

          {/* Icon */}
          <motion.div
            className="relative z-10 text-white"
            animate={{ scale: isHovered || isExpanded ? 1.1 : 1 }}
            transition={{ type: "spring", stiffness: 400, damping: 17 }}
          >
            <Icon size={18} />
          </motion.div>
        </motion.div>

        {/* Active indicator dot */}
        {item.status === "completed" && (
          <motion.div
            className="absolute -bottom-2 left-1/2 -translate-x-1/2 h-1 w-1 rounded-full bg-white/70"
            animate={{
              scale: isExpanded ? 1.5 : 1,
              opacity: isExpanded ? 1 : 0.6,
            }}
          />
        )}
      </motion.div>

      {/* ── Tooltip (shows on hover when not expanded) ── */}
      <AnimatePresence>
        {isHovered && !isExpanded && (
          <motion.div
            initial={{ opacity: 0, y: 4, scale: 0.85 }}
            animate={{ opacity: 1, y: -8, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.85 }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            className="absolute -top-10 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-zinc-800/95 px-2.5 py-1 text-[10px] font-semibold text-white shadow-lg backdrop-blur-md pointer-events-none"
          >
            {item.title}
            {/* Arrow */}
            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 h-2 w-2 rotate-45 bg-zinc-800/95" />
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Label (always visible below icon) ── */}
      <motion.div
        className="absolute top-14 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider"
        animate={{
          color: isExpanded ? "rgba(255,255,255,1)" : "rgba(255,255,255,0.5)",
          scale: isExpanded ? 1.1 : 1,
        }}
        transition={{ duration: 0.25 }}
      >
        {item.title}
      </motion.div>

      {/* ── Expanded card ── */}
      <AnimatePresence>
        {isExpanded && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: -10 }}
            transition={{ type: "spring", stiffness: 350, damping: 25 }}
            className="absolute top-22 left-1/2 -translate-x-1/2"
            style={{ zIndex: 210 }}
          >
            {/* Connector line */}
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 h-3 w-px bg-gradient-to-b from-transparent to-white/30" />

            <Card className="w-64 border-white/15 bg-zinc-900/95 shadow-2xl shadow-black/60 backdrop-blur-2xl overflow-visible">
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <Badge className={`px-2 text-[10px] border-0 ${accent.bg}`}>
                    {getStatusLabel(item.status)}
                  </Badge>
                  <span className="font-mono text-[10px] text-white/40">{item.date}</span>
                </div>
                <CardTitle className="mt-2 text-sm text-white">{item.title}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-xs text-white/70">
                <p className="max-h-[120px] overflow-y-auto leading-relaxed pr-1">{item.content}</p>

                {/* Energy bar */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[10px]">
                    <span className="flex items-center gap-1 text-white/40">
                      <Zap size={9} />
                      Activity
                    </span>
                    <span className="font-mono text-white/40">{item.energy}%</span>
                  </div>
                  <div className="h-1 w-full overflow-hidden rounded-full bg-white/10">
                    <motion.div
                      className={`h-full bg-gradient-to-r ${accent.bar}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${item.energy}%` }}
                      transition={{ duration: 0.6, ease: "easeOut" }}
                    />
                  </div>
                </div>

                {/* Action button */}
                {item.actionLabel && item.actionHref && (
                  <a
                    href={item.actionHref}
                    onClick={(e) => {
                      e.stopPropagation()
                      onActionClick?.(item)
                    }}
                    className={`flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-xs font-semibold text-white transition-all active:scale-95 bg-gradient-to-r ${accent.bar} shadow-lg`}
                  >
                    {item.actionLabel}
                    <ArrowRight size={12} />
                  </a>
                )}

                {/* Related nodes */}
                {item.relatedIds.length > 0 && (
                  <div className="border-t border-white/10 pt-3">
                    <div className="mb-1.5 flex items-center gap-1 text-[10px] text-white/40">
                      <Link size={9} />
                      <span className="uppercase tracking-wider">Connected</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {item.relatedIds.map((relId) => {
                        const rel = timelineData.find((i) => i.id === relId)
                        return (
                          <Button
                            key={relId}
                            variant="outline"
                            size="sm"
                            className="h-6 gap-1 border-white/20 px-2 py-0 text-[10px]"
                            onClick={(e) => { e.stopPropagation(); onRelatedClick(relId) }}
                          >
                            {rel?.title}
                            <ArrowRight size={8} />
                          </Button>
                        )
                      })}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/* ─── Main component ─────────────────────────────────────────────────────── */

export default function RadialOrbitalTimeline({
  timelineData,
  onActionClick,
  onOrbClick,
  isThinking = false,
  autoExpandId = null,
  orbCardContent,
  closeOrbTrigger = 0,
}: RadialOrbitalTimelineProps) {
  const [expandedItems, setExpandedItems] = useState<Record<number, boolean>>({})
  const [rotationAngle, setRotationAngle] = useState<number>(0)
  const [autoRotate, setAutoRotate] = useState<boolean>(true)
  const [pulseEffect, setPulseEffect] = useState<Record<number, boolean>>({})
  const [activeNodeId, setActiveNodeId] = useState<number | null>(null)
  const [orbExpanded, setOrbExpanded] = useState(false)

  useEffect(() => {
    if (closeOrbTrigger === 0) return
    setOrbExpanded(false)
    setAutoRotate(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closeOrbTrigger])

  const containerRef = useRef<HTMLDivElement>(null)
  const orbitRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (autoExpandId == null) return
    setExpandedItems({ [autoExpandId]: true })
    setActiveNodeId(autoExpandId)
    setAutoRotate(false)
    const related = timelineData.find((i) => i.id === autoExpandId)?.relatedIds ?? []
    const pulse: Record<number, boolean> = {}
    related.forEach((r) => { pulse[r] = true })
    setPulseEffect(pulse)
    centerViewOnNode(autoExpandId)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoExpandId])

  const handleContainerClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === containerRef.current || e.target === orbitRef.current) {
      setExpandedItems({})
      setActiveNodeId(null)
      setPulseEffect({})
      setAutoRotate(true)
      setOrbExpanded(false)
    }
  }

  const toggleItem = (id: number) => {
    setExpandedItems((prev) => {
      const newState: Record<number, boolean> = {}
      Object.keys(prev).forEach((key) => { newState[parseInt(key)] = false })
      newState[id] = !prev[id]

      if (!prev[id]) {
        setActiveNodeId(id)
        setAutoRotate(false)
        const related = getRelatedItems(id)
        const pulse: Record<number, boolean> = {}
        related.forEach((r) => { pulse[r] = true })
        setPulseEffect(pulse)
        centerViewOnNode(id)
      } else {
        setActiveNodeId(null)
        setAutoRotate(true)
        setPulseEffect({})
      }
      return newState
    })
  }

  useEffect(() => {
    if (!autoRotate) return
    const t = setInterval(() => {
      setRotationAngle((prev) => Number(((prev + 0.3) % 360).toFixed(3)))
    }, 50)
    return () => clearInterval(t)
  }, [autoRotate])

  const centerViewOnNode = (nodeId: number) => {
    const idx = timelineData.findIndex((i) => i.id === nodeId)
    const total = timelineData.length
    const targetAngle = (idx / total) * 360
    setRotationAngle(270 - targetAngle)
  }

  const calculateNodePosition = (index: number, total: number) => {
    const angle = ((index / total) * 360 + rotationAngle) % 360
    const radius = 160
    const radian = (angle * Math.PI) / 180
    const x = radius * Math.cos(radian)
    const y = radius * Math.sin(radian)
    const zIndex = Math.round(100 + 50 * Math.cos(radian))
    const opacity = Math.max(0.4, Math.min(1, 0.4 + 0.6 * ((1 + Math.sin(radian)) / 2)))
    return { x, y, angle, zIndex, opacity }
  }

  const getRelatedItems = (itemId: number): number[] => {
    return timelineData.find((i) => i.id === itemId)?.relatedIds ?? []
  }

  const isRelatedToActive = (itemId: number): boolean => {
    if (!activeNodeId) return false
    return getRelatedItems(activeNodeId).includes(itemId)
  }

  return (
    <div
      className="relative flex h-[520px] w-full items-center justify-center overflow-hidden"
      ref={containerRef}
      onClick={handleContainerClick}
    >
      <div
        className="absolute flex h-full w-full items-center justify-center"
        ref={orbitRef}
        style={{ perspective: "1000px" }}
      >
        {/* Center orb — WebGL powered */}
        <motion.div
          className="absolute z-10 flex h-20 w-20 cursor-pointer items-center justify-center rounded-full"
          whileTap={{ scale: 0.92 }}
          onClick={(e) => {
            e.stopPropagation()
            if (!isThinking && orbCardContent) {
              setOrbExpanded((prev) => {
                const next = !prev
                if (next) { setExpandedItems({}); setAutoRotate(false) }
                else { setAutoRotate(true) }
                return next
              })
            }
            onOrbClick?.()
          }}
        >
          <VoicePoweredOrb
            enableVoiceControl={false}
            hue={isThinking ? 280 : 0}
            className="h-20 w-20 rounded-full overflow-hidden"
          />
          {/* Thinking: fast spinning ring */}
          {isThinking && (
            <motion.div
              className="absolute h-24 w-24 rounded-full border-2 border-transparent border-t-violet-400 border-r-fuchsia-400 opacity-80"
              animate={{ rotate: 360 }}
              transition={{ repeat: Infinity, duration: 1, ease: "linear" }}
            />
          )}
          <motion.div
            className="absolute h-24 w-24 rounded-full border border-white/15"
            animate={{ scale: [1, 1.15, 1], opacity: [0.3, 0.1, 0.3] }}
            transition={{ repeat: Infinity, duration: 3, ease: "easeInOut" }}
          />
        </motion.div>

        {/* Orbit ring */}
        <div className="absolute h-80 w-80 rounded-full border border-white/[0.07]" />

        {/* Nodes */}
        {timelineData.map((item, index) => {
          const pos = calculateNodePosition(index, timelineData.length)
          return (
            <OrbitalNode
              key={item.id}
              item={item}
              isExpanded={!!expandedItems[item.id]}
              isRelated={isRelatedToActive(item.id)}
              isPulsing={!!pulseEffect[item.id]}
              posX={pos.x}
              posY={pos.y}
              posZIndex={pos.zIndex}
              posOpacity={pos.opacity}
              onToggle={() => toggleItem(item.id)}
              onActionClick={onActionClick}
              timelineData={timelineData}
              onRelatedClick={(id) => toggleItem(id)}
            />
          )
        })}
      </div>

      {/* Orb chat card — floats centered over the orbital, above all nodes */}
      <AnimatePresence>
        {orbExpanded && orbCardContent && (
          <>
            {/* Dim backdrop — tap to close */}
            <motion.div
              key="orb-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="absolute inset-0 z-[250] bg-black/50 backdrop-blur-[3px]"
              onClick={() => { setOrbExpanded(false); setAutoRotate(true) }}
            />
            {/* Floating card */}
            <motion.div
              key="orb-card"
              initial={{ opacity: 0, scale: 0.88, y: -16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.88, y: -16 }}
              transition={{ type: "spring", stiffness: 380, damping: 26 }}
              className="absolute left-1/2 top-[54%] z-[300] w-[calc(100%-32px)] -translate-x-1/2 -translate-y-1/2"
              onClick={(e: React.MouseEvent) => e.stopPropagation()}
            >
              {/* Connector line up to orb */}
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 h-8 w-px bg-gradient-to-b from-transparent via-white/30 to-white/20" />
              <div className="overflow-hidden rounded-3xl border border-white/[0.15] bg-zinc-950/98 shadow-2xl shadow-black/80 backdrop-blur-2xl">
                {orbCardContent}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}
