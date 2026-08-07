'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * Dropdown styled to the portal instead of the browser's native one.
 *
 * A bare <select> renders its list with OS chrome — white-on-grey system
 * typography that ignores the dark, monospaced surface everything else uses.
 * This keeps the same keyboard affordances (Escape, click-outside, Enter) and
 * adds a filter, since the bank list runs to ~40 entries where scanning by eye
 * is slower than typing three letters.
 */
export function SelectMenu({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchable,
  disabled,
  ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SelectOption[];
  placeholder?: string;
  /** Defaults on once the list is long enough that scanning it is a chore. */
  searchable?: boolean;
  disabled?: boolean;
  ariaLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const showSearch = searchable ?? options.length > 8;
  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = query
    ? options.filter((o) => o.label.toLowerCase().includes(query.toLowerCase()))
    : options;

  // Close on outside click and on Escape — a dropdown that traps the page is
  // worse than the native one it replaces.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && showSearch) searchRef.current?.focus();
    if (!open) setQuery('');
  }, [open, showSearch]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between gap-3 rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
          disabled
            ? 'cursor-not-allowed border-white/5 bg-black/20 text-zinc-600'
            : open
            ? 'border-blue-500/40 bg-black/40 text-white'
            : 'border-white/8 bg-black/40 text-white hover:border-white/15'
        }`}
      >
        <span className={selected ? '' : 'text-zinc-600'}>{selected?.label ?? placeholder}</span>
        <ChevronDown
          size={14}
          className={`shrink-0 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open && (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-lg border border-white/10 bg-zinc-950 shadow-2xl shadow-black/60">
          {showSearch && (
            <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2.5">
              <Search size={12} className="shrink-0 text-zinc-600" />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search…"
                className="w-full bg-transparent text-sm text-white placeholder-zinc-600 focus:outline-none"
              />
            </div>
          )}

          <div role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-4 py-3 text-xs text-zinc-600">No match</p>
            ) : (
              filtered.map((o) => {
                const isSelected = o.value === value;
                return (
                  <button
                    key={o.value}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => {
                      onChange(o.value);
                      setOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                      isSelected ? 'bg-blue-600/15 text-blue-300' : 'text-zinc-300 hover:bg-white/5 hover:text-white'
                    }`}
                  >
                    <span>{o.label}</span>
                    {isSelected && <Check size={13} className="shrink-0" />}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
