'use client'

import { useState, useRef, useEffect } from 'react'

type SelectOption = { value: string; label: string; sub?: string }
type SelectGroup = { group: string; options: SelectOption[] }
type SelectItem = SelectOption | SelectGroup

function isGroup(item: SelectItem): item is SelectGroup {
  return 'group' in item
}

export function CustomSelect({
  value,
  onChange,
  items,
  placeholder = 'Select...',
  className = '',
}: {
  value: string
  onChange: (value: string) => void
  items: SelectItem[]
  placeholder?: string
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    if (open) document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  const allOptions: SelectOption[] = items.flatMap((item) =>
    isGroup(item) ? item.options : [item]
  )
  const selected = allOptions.find((o) => o.value === value)
  const displayLabel = selected?.label ?? placeholder

  const handleSelect = (val: string) => {
    onChange(val)
    setOpen(false)
  }

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/30 px-3 py-2.5 text-sm text-white hover:border-white/20 focus:outline-none"
      >
        <span className={selected ? 'text-white' : 'text-white/30'}>{displayLabel}</span>
        <svg
          className={`h-4 w-4 text-white/30 transition-transform ${open ? 'rotate-180' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-white/10 bg-[#111118] shadow-2xl">
          <div className="max-h-60 overflow-y-auto py-1">
            {items.map((item, i) =>
              isGroup(item) ? (
                item.options.length > 0 ? (
                  <div key={i}>
                    <div className="px-3 py-1.5 text-[10px] font-semibold uppercase tracking-widest text-white/30">
                      {item.group}
                    </div>
                    {item.options.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => handleSelect(opt.value)}
                        className={`flex w-full items-center justify-between px-4 py-2 text-sm transition-colors hover:bg-white/[0.06] ${
                          opt.value === value ? 'text-white' : 'text-white/70'
                        }`}
                      >
                        <span>{opt.label}</span>
                        {opt.value === value && (
                          <svg className="h-3.5 w-3.5 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                          </svg>
                        )}
                      </button>
                    ))}
                  </div>
                ) : null
              ) : (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => handleSelect(item.value)}
                  className={`flex w-full items-center justify-between px-3 py-2 text-sm transition-colors hover:bg-white/[0.06] ${
                    item.value === value ? 'text-white' : 'text-white/70'
                  }`}
                >
                  <span>{item.label}</span>
                  {item.value === value && (
                    <svg className="h-3.5 w-3.5 text-white/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </button>
              )
            )}
          </div>
        </div>
      )}
    </div>
  )
}
