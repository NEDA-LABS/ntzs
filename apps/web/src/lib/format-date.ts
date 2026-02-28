const EAT_LOCALE = 'en-TZ'
const EAT_TIMEZONE = 'Africa/Dar_es_Salaam'

/**
 * Format a date as a short date in EAT (UTC+3), e.g. "28 Feb 2026"
 */
export function formatDateEAT(date: Date | string | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleDateString(EAT_LOCALE, {
    timeZone: EAT_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

/**
 * Format a date with time in EAT (UTC+3), e.g. "28 Feb 2026, 14:35"
 */
export function formatDateTimeEAT(date: Date | string | null | undefined): string {
  if (!date) return '—'
  return new Date(date).toLocaleString(EAT_LOCALE, {
    timeZone: EAT_TIMEZONE,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
