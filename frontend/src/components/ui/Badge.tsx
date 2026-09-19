import React from 'react'
import { cn } from '../../lib/utils'

interface BadgeProps {
  children: React.ReactNode
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'muted'
  size?: 'sm' | 'md'
  dot?: boolean
  className?: string
}

const variants = {
  default: 'bg-[rgba(209,208,208,0.08)] text-[rgba(209,208,208,0.7)] border-[rgba(209,208,208,0.12)]',
  success: 'bg-[rgba(109,191,140,0.1)] text-[#6dbf8c] border-[rgba(109,191,140,0.2)]',
  warning: 'bg-[rgba(232,192,123,0.1)] text-[#e8c07b] border-[rgba(232,192,123,0.2)]',
  danger: 'bg-[rgba(232,123,123,0.1)] text-[#e87b7b] border-[rgba(232,123,123,0.2)]',
  info: 'bg-[rgba(123,174,232,0.1)] text-[#7baee8] border-[rgba(123,174,232,0.2)]',
  muted: 'bg-transparent text-[rgba(209,208,208,0.4)] border-[rgba(209,208,208,0.08)]',
}

const dotColors = {
  default: 'bg-[rgba(209,208,208,0.7)]',
  success: 'bg-[#6dbf8c]',
  warning: 'bg-[#e8c07b]',
  danger: 'bg-[#e87b7b]',
  info: 'bg-[#7baee8]',
  muted: 'bg-[rgba(209,208,208,0.4)]',
}

export const Badge: React.FC<BadgeProps> = ({
  children,
  variant = 'default',
  size = 'sm',
  dot = false,
  className,
}) => (
  <span
    className={cn(
      'inline-flex items-center gap-1.5 border font-medium tracking-wide rounded-sm',
      size === 'sm' ? 'px-2 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
      variants[variant],
      className
    )}
  >
    {dot && (
      <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', dotColors[variant])} />
    )}
    {children}
  </span>
)

// Security-specific status badge
interface SecurityBadgeProps {
  status: 'active' | 'expired' | 'revoked' | 'protected' | 'pending'
}

export const SecurityBadge: React.FC<SecurityBadgeProps> = ({ status }) => {
  const config = {
    active: { variant: 'success' as const, label: 'Active', dot: true },
    expired: { variant: 'muted' as const, label: 'Expired', dot: false },
    revoked: { variant: 'danger' as const, label: 'Revoked', dot: false },
    protected: { variant: 'info' as const, label: 'Protected', dot: false },
    pending: { variant: 'warning' as const, label: 'Processing', dot: true },
  }
  const c = config[status]
  return <Badge variant={c.variant} dot={c.dot}>{c.label}</Badge>
}
