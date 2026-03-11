"use client"

import type React from "react"
import { useState } from "react"
import { ChevronUp } from "lucide-react"
import { cn } from "@/lib/utils"

interface Activity {
  id: string
  icon: React.ReactNode
  label: string
  amount: number
  status: string
  date: string
  statusColor: string
  isDeposit: boolean
}

interface ActivityDropdownProps {
  activities: Activity[]
  title: string
  subtitle?: string
}

export function ActivityDropdown({ activities, title, subtitle }: ActivityDropdownProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div
      className={cn(
        "w-full overflow-hidden cursor-pointer select-none",
        "rounded-2xl bg-[#12121e] ring-1 ring-white/[0.06]",
        "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
        isOpen ? "rounded-3xl" : "rounded-2xl",
      )}
      onClick={() => setIsOpen(!isOpen)}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/[0.05]">
        <div className="flex-1 overflow-hidden">
          <h2 className="text-sm font-semibold text-white">{title}</h2>
          <p
            className={cn(
              "text-xs text-zinc-500",
              "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
              isOpen ? "opacity-0 max-h-0 mt-0" : "opacity-100 max-h-6 mt-0.5",
            )}
          >
            {subtitle}
          </p>
        </div>
        <div className="flex items-center gap-1">
          {!isOpen && (
            <span className="text-xs font-medium text-blue-400 mr-2">View all</span>
          )}
          <ChevronUp
            className={cn(
              "h-4 w-4 text-zinc-400 transition-transform duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
              isOpen ? "rotate-0" : "rotate-180",
            )}
          />
        </div>
      </div>

      {/* Activity List */}
      <div
        className={cn(
          "grid",
          "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
          isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0",
        )}
      >
        <div className="overflow-hidden">
          <div className="divide-y divide-white/[0.04]">
            {activities.map((activity, index) => (
              <div
                key={activity.id}
                className={cn(
                  "flex items-center justify-between px-5 py-4",
                  "transition-all duration-500 ease-[cubic-bezier(0.4,0,0.2,1)]",
                  "hover:bg-white/[0.03]",
                  isOpen ? "translate-y-0 opacity-100" : "translate-y-4 opacity-0",
                )}
                style={{
                  transitionDelay: isOpen ? `${index * 50}ms` : "0ms",
                }}
              >
                <div className="flex items-center gap-3.5">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
                    activity.isDeposit ? 'bg-emerald-500/12' : 'bg-rose-500/12'
                  }`}>
                    {activity.icon}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">{activity.label}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{activity.date}</p>
                  </div>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-semibold font-mono ${activity.isDeposit ? 'text-emerald-400' : 'text-rose-300'}`}>
                    {activity.isDeposit ? '+' : '-'}{activity.amount.toLocaleString()} TZS
                  </p>
                  <p className={`mt-0.5 text-xs capitalize ${activity.statusColor}`}>
                    {activity.status}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
