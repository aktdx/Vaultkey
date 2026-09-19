import React from 'react'
import { cn } from '../../lib/utils'

interface CardProps {
  className?: string
  children: React.ReactNode
  hover?: boolean
  as?: React.ElementType
  onClick?: () => void
}

export const Card: React.FC<CardProps> = ({
  className,
  children,
  hover = false,
  as: Tag = 'div',
  onClick,
}) => (
  <Tag
    className={cn(
      'rounded-md border border-[rgba(209,208,208,0.08)] bg-[#0f0f0f]',
      hover && 'transition-all duration-300 hover:border-[rgba(209,208,208,0.15)] hover:bg-[#131313] cursor-pointer',
      className
    )}
    onClick={onClick}
  >
    {children}
  </Tag>
)

interface CardHeaderProps {
  className?: string
  children: React.ReactNode
}

export const CardHeader: React.FC<CardHeaderProps> = ({ className, children }) => (
  <div className={cn('px-5 py-4 border-b border-[rgba(209,208,208,0.06)]', className)}>
    {children}
  </div>
)

export const CardBody: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <div className={cn('px-5 py-4', className)}>
    {children}
  </div>
)

export const CardFooter: React.FC<{ className?: string; children: React.ReactNode }> = ({ className, children }) => (
  <div className={cn('px-5 py-3.5 border-t border-[rgba(209,208,208,0.06)]', className)}>
    {children}
  </div>
)
