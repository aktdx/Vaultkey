import React from 'react'
import { cn } from '../../lib/utils'

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline'
  size?: 'sm' | 'md' | 'lg'
  loading?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'primary', size = 'md', loading, leftIcon, rightIcon, children, disabled, ...props }, ref) => {
    const base = 'inline-flex items-center justify-center gap-2 font-medium transition-all duration-200 focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 focus-visible:outline-vault-silver disabled:pointer-events-none disabled:opacity-40 select-none'

    const variants = {
      primary: 'bg-[#D1D0D0] text-black hover:bg-white active:scale-[0.98] border border-transparent',
      secondary: 'bg-[#181818] text-[#D1D0D0] border border-[rgba(209,208,208,0.12)] hover:border-[rgba(209,208,208,0.25)] hover:bg-[#1f1f1f] active:scale-[0.98]',
      ghost: 'text-[rgba(209,208,208,0.7)] hover:text-[#D1D0D0] hover:bg-[rgba(209,208,208,0.06)] active:scale-[0.98]',
      danger: 'bg-[#3d1515] text-[#e87b7b] border border-[rgba(232,123,123,0.2)] hover:bg-[#4a1a1a] hover:border-[rgba(232,123,123,0.35)] active:scale-[0.98]',
      outline: 'bg-transparent text-[#D1D0D0] border border-[rgba(209,208,208,0.25)] hover:bg-[rgba(209,208,208,0.05)] active:scale-[0.98]',
    }

    const sizes = {
      sm: 'h-8 px-3 text-xs rounded-sm tracking-wide',
      md: 'h-10 px-5 text-sm rounded tracking-wide',
      lg: 'h-12 px-7 text-sm rounded-md tracking-wider',
    }

    return (
      <button
        ref={ref}
        className={cn(base, variants[variant], sizes[size], className)}
        disabled={disabled || loading}
        {...props}
      >
        {loading ? (
          <span className="inline-block w-4 h-4 border border-current border-t-transparent rounded-full animate-spin" />
        ) : leftIcon}
        {children}
        {!loading && rightIcon}
      </button>
    )
  }
)
Button.displayName = 'Button'
