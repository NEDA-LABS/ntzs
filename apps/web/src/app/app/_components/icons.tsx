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
