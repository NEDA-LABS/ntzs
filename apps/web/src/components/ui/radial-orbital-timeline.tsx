"use client"

import { useState, useEffect, useRef } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { ArrowRight, Link, Zap } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"

export interface TimelineItem {
  id: number
  title: string
  date: string
  content: string
  category: string
  icon: React.ElementType
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
  const nodeRefs = useRef<Record<number, HTMLDivElement | null>>({})

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

  const accentClasses = {
    blue:    { ring: "border-blue-400",    bg: "bg-blue-500/20 text-blue-300",    bar: "from-blue-500 to-blue-400"    },
    violet:  { ring: "border-violet-400",  bg: "bg-violet-500/20 text-violet-300", bar: "from-violet-500 to-violet-400" },
    emerald: { ring: "border-emerald-400", bg: "bg-emerald-500/20 text-emerald-300", bar: "from-emerald-500 to-emerald-400" },
  }

  const getStatusLabel = (status: TimelineItem["status"]) => {
    if (status === "completed")  return "ACTIVE"
    if (status === "in-progress") return "IN PROGRESS"
    return "PENDING"
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
        {/* Center orb */}
        <div
          className={`absolute z-10 flex h-16 w-16 cursor-pointer items-center justify-center rounded-full transition-transform duration-200 active:scale-95 ${
            isThinking
              ? "bg-gradient-to-br from-violet-400 via-fuchsia-500 to-blue-400"
              : "bg-gradient-to-br from-violet-500 via-blue-500 to-emerald-500"
          }`}
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
          {/* Thinking: fast spinning ring */}
          {isThinking && (
            <div className="absolute h-20 w-20 animate-spin rounded-full border-2 border-transparent border-t-violet-400 border-r-fuchsia-400 opacity-80" />
          )}
          <div className={`absolute h-20 w-20 animate-ping rounded-full border border-white/20 opacity-70 ${ isThinking ? "[animation-duration:0.6s]" : "" }`} />
          <div className={`absolute h-24 w-24 animate-ping rounded-full border border-white/10 opacity-50 ${ isThinking ? "[animation-duration:0.8s]" : "" }`} style={{ animationDelay: "0.2s" }} />
          {isThinking && (
            <div className="absolute h-28 w-28 animate-ping rounded-full border border-fuchsia-500/20 opacity-40" style={{ animationDelay: "0.4s" }} />
          )}
          <div className={`h-8 w-8 rounded-full backdrop-blur-md transition-colors duration-300 ${ isThinking ? "bg-fuchsia-200/90" : orbExpanded ? "bg-violet-300" : "bg-white/80" }`} />
        </div>

        {/* Orbit ring */}
        <div className="absolute h-80 w-80 rounded-full border border-white/10" />

        {/* Nodes */}
        {timelineData.map((item, index) => {
          const pos = calculateNodePosition(index, timelineData.length)
          const isExpanded = expandedItems[item.id]
          const isRelated = isRelatedToActive(item.id)
          const isPulsing = pulseEffect[item.id]
          const Icon = item.icon
          const accent = accentClasses[item.accentColor ?? "violet"]

          return (
            <div
              key={item.id}
              ref={(el) => { nodeRefs.current[item.id] = el }}
              className="absolute cursor-pointer transition-all duration-700"
              style={{
                transform: `translate(${pos.x}px, ${pos.y}px)`,
                zIndex: isExpanded ? 200 : pos.zIndex,
                opacity: isExpanded ? 1 : pos.opacity,
              }}
              onClick={(e) => { e.stopPropagation(); toggleItem(item.id) }}
            >
              {/* Energy aura */}
              <div
                className={`absolute rounded-full ${isPulsing ? "animate-pulse" : ""}`}
                style={{
                  background: "radial-gradient(circle, rgba(255,255,255,0.15) 0%, rgba(255,255,255,0) 70%)",
                  width: `${item.energy * 0.4 + 40}px`,
                  height: `${item.energy * 0.4 + 40}px`,
                  left: `-${(item.energy * 0.4 + 40 - 40) / 2}px`,
                  top: `-${(item.energy * 0.4 + 40 - 40) / 2}px`,
                }}
              />

              {/* Node icon */}
              <div className={`
                flex h-10 w-10 items-center justify-center rounded-full border-2 transition-all duration-300
                ${isExpanded
                  ? `bg-white text-black border-white shadow-lg shadow-white/20 scale-150`
                  : isRelated
                  ? `bg-white/30 text-white ${accent.ring} animate-pulse`
                  : `bg-zinc-900 text-white/70 border-white/30`
                }
              `}>
                <Icon size={15} />
              </div>

              {/* Label */}
              <div className={`
                absolute top-12 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold uppercase tracking-wider transition-all duration-300
                ${isExpanded ? "text-white scale-125" : "text-white/60"}
              `}>
                {item.title}
              </div>

              {/* Expanded card */}
              {isExpanded && (
                <Card className="absolute top-20 left-1/2 w-64 -translate-x-1/2 border-white/20 bg-zinc-900/95 shadow-xl shadow-black/50 backdrop-blur-xl overflow-visible">
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 h-3 w-px bg-white/30" />
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
                        <div
                          className={`h-full bg-gradient-to-r ${accent.bar}`}
                          style={{ width: `${item.energy}%` }}
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
                                onClick={(e) => { e.stopPropagation(); toggleItem(relId) }}
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
              )}
            </div>
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
