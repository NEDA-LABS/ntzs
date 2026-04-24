import type { ComponentPropsWithoutRef } from 'react'

export type IconProps = ComponentPropsWithoutRef<'svg'>

function IconBase(props: IconProps) {
  const { className, ...rest } = props
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    />
  )
}

export function IconChevronLeft(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M15 19l-7-7 7-7" />
    </IconBase>
  )
}

export function IconChevronRight(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 5l7 7-7 7" />
    </IconBase>
  )
}

export function IconArrowDown(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14" />
      <path d="M19 12l-7 7-7-7" />
    </IconBase>
  )
}

export function IconPlus(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 5v14" />
      <path d="M5 12h14" />
    </IconBase>
  )
}

export function IconSend(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M21 3L9 15" />
      <path d="M21 3l-7 19-3-7-7-3 19-9z" />
    </IconBase>
  )
}

export function IconWithdraw(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 3v10" />
      <path d="M8 9l4 4 4-4" />
      <path d="M5 21h14" />
    </IconBase>
  )
}

export function IconDashboard(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 4h7v7H4z" />
      <path d="M13 4h7v7h-7z" />
      <path d="M4 13h7v7H4z" />
      <path d="M13 13h7v7h-7z" />
    </IconBase>
  )
}

export function IconWallet(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 7.5A2.5 2.5 0 016 5h13.5" />
      <path d="M3.5 9.5A2.5 2.5 0 016 7h13.5A2.5 2.5 0 0122 9.5v9A2.5 2.5 0 0119.5 21H6A2.5 2.5 0 013.5 18.5z" />
      <path d="M17 13h3" />
    </IconBase>
  )
}

export function IconActivity(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M6 20V10" />
      <path d="M12 20V4" />
      <path d="M18 20v-8" />
    </IconBase>
  )
}

export function IconSparkles(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 2l1.2 4.2L17.4 8 13.2 9.2 12 13.4 10.8 9.2 6.6 8l4.2-1.8L12 2z" />
      <path d="M19 12l.8 2.8L22.6 16 19.8 16.8 19 19.6 18.2 16.8 15.4 16l2.8-1.2L19 12z" />
    </IconBase>
  )
}

export function IconUsers(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M16 11a3 3 0 10-6 0" />
      <path d="M4 20a8 8 0 0116 0" />
      <path d="M20 20a6 6 0 00-6-6" />
      <path d="M4 20a6 6 0 016-6" />
    </IconBase>
  )
}

export function IconGift(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M20 12v9H4v-9" />
      <path d="M22 7H2v5h20V7z" />
      <path d="M12 22V7" />
      <path d="M12 7H7.5a2.5 2.5 0 010-5C10 2 12 7 12 7z" />
      <path d="M12 7h4.5a2.5 2.5 0 000-5C14 2 12 7 12 7z" />
    </IconBase>
  )
}

export function IconBank(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M4 10h16" />
      <path d="M6 10v8" />
      <path d="M10 10v8" />
      <path d="M14 10v8" />
      <path d="M18 10v8" />
      <path d="M3 18h18" />
      <path d="M12 3l9 5H3l9-5z" />
    </IconBase>
  )
}

export function IconPhone(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 3h6" />
      <path d="M9 21h6" />
      <path d="M9 3h-.5A2.5 2.5 0 006 5.5v13A2.5 2.5 0 008.5 21H15.5A2.5 2.5 0 0018 18.5v-13A2.5 2.5 0 0015.5 3H15" />
    </IconBase>
  )
}

export function IconCard(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M3.5 7.5h17" />
      <path d="M3.5 10.5h17" />
      <path d="M5.5 15h6" />
      <path d="M3.5 6.5A2.5 2.5 0 016 4h13.5A2.5 2.5 0 0122 6.5v11A2.5 2.5 0 0119.5 20H6A2.5 2.5 0 013.5 17.5z" />
    </IconBase>
  )
}

export function IconReceipt(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M7 3h10v18l-2-1-2 1-2-1-2 1-2-1-2 1V3z" />
      <path d="M9 7h6" />
      <path d="M9 11h6" />
      <path d="M9 15h4" />
    </IconBase>
  )
}

export function IconCheckCircle(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M22 12a10 10 0 11-20 0 10 10 0 0120 0z" />
      <path d="M8 12l2.5 2.5L16 9" />
    </IconBase>
  )
}

export function IconInfo(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 17v-6" />
      <path d="M12 8h.01" />
      <path d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </IconBase>
  )
}

export function IconCopy(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M9 9h10v10H9z" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </IconBase>
  )
}

export function IconLink(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 13a5 5 0 017-7l1 1" />
      <path d="M14 11a5 5 0 01-7 7l-1-1" />
      <path d="M8 12l8 0" />
    </IconBase>
  )
}

export function IconChain(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" />
    </IconBase>
  )
}

export function IconCoins(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="8" cy="8" r="6" />
      <path d="M18.09 10.37A6 6 0 1110.34 18" />
      <path d="M7 6h2v4" />
      <path d="M16 14h2v4" />
    </IconBase>
  )
}

export function IconClock(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </IconBase>
  )
}

export function IconShield(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </IconBase>
  )
}

export function IconShieldCheck(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="M9 12l2 2 4-4" />
    </IconBase>
  )
}

export function IconTrendingUp(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M23 6l-9.5 9.5-5-5L1 18" />
      <path d="M17 6h6v6" />
    </IconBase>
  )
}

export function IconFileText(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
      <path d="M16 13H8" />
      <path d="M16 17H8" />
      <path d="M10 9H8" />
    </IconBase>
  )
}

export function IconEye(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
      <circle cx="12" cy="12" r="3" />
    </IconBase>
  )
}

export function IconDatabase(props: IconProps) {
  return (
    <IconBase {...props}>
      <ellipse cx="12" cy="5" rx="9" ry="3" />
      <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
      <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
    </IconBase>
  )
}

export function IconBarChart(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M12 20V10" />
      <path d="M18 20V4" />
      <path d="M6 20v-4" />
    </IconBase>
  )
}

export function IconAlertCircle(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v4" />
      <path d="M12 16h.01" />
    </IconBase>
  )
}

export function IconSettings(props: IconProps) {
  return (
    <IconBase {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06a1.65 1.65 0 00.33-1.82 1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06a1.65 1.65 0 001.82.33H9a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06a1.65 1.65 0 00-.33 1.82V9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z" />
    </IconBase>
  )
}

export function IconCollect(props: IconProps) {
  return (
    <IconBase {...props}>
      <path d="M22 12h-6l-2 3H10l-2-3H2" />
      <path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6L18.55 5.11A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" />
    </IconBase>
  )
}

export function IconZap(props: IconProps) {
  return (
    <IconBase {...props}>
      <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
    </IconBase>
  )
}
