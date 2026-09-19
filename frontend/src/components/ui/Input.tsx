import React from 'react'
import { cn } from '../../lib/utils'

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
  leftIcon?: React.ReactNode
  rightElement?: React.ReactNode
}

export const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, label, error, hint, leftIcon, rightElement, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)

    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-[rgba(209,208,208,0.6)] tracking-wide uppercase">
            {label}
          </label>
        )}
        <div className="relative flex items-center">
          {leftIcon && (
            <span className="absolute left-3 text-[rgba(209,208,208,0.4)] pointer-events-none">
              {leftIcon}
            </span>
          )}
          <input
            ref={ref}
            id={inputId}
            className={cn(
              'w-full bg-[#111] border text-[#D1D0D0] placeholder-[rgba(209,208,208,0.25)]',
              'rounded h-10 px-3 text-sm transition-all duration-200',
              'focus:outline-none focus:border-[rgba(209,208,208,0.4)] focus:bg-[#161616]',
              'disabled:opacity-40 disabled:cursor-not-allowed',
              error
                ? 'border-[rgba(232,123,123,0.5)] focus:border-[rgba(232,123,123,0.8)]'
                : 'border-[rgba(209,208,208,0.1)] hover:border-[rgba(209,208,208,0.2)]',
              leftIcon && 'pl-10',
              rightElement && 'pr-10',
              className
            )}
            {...props}
          />
          {rightElement && (
            <span className="absolute right-3 text-[rgba(209,208,208,0.4)]">
              {rightElement}
            </span>
          )}
        </div>
        {error && <p className="text-xs text-[#e87b7b]">{error}</p>}
        {hint && !error && <p className="text-xs text-[rgba(209,208,208,0.35)]">{hint}</p>}
      </div>
    )
  }
)
Input.displayName = 'Input'

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string
  error?: string
}

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, label, error, id, ...props }, ref) => {
    const inputId = id || (label ? label.toLowerCase().replace(/\s+/g, '-') : undefined)
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label htmlFor={inputId} className="text-xs font-medium text-[rgba(209,208,208,0.6)] tracking-wide uppercase">
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          className={cn(
            'w-full bg-[#111] border text-[#D1D0D0] placeholder-[rgba(209,208,208,0.25)]',
            'rounded px-3 py-2.5 text-sm transition-all duration-200 resize-none',
            'focus:outline-none focus:border-[rgba(209,208,208,0.4)] focus:bg-[#161616]',
            error
              ? 'border-[rgba(232,123,123,0.5)]'
              : 'border-[rgba(209,208,208,0.1)] hover:border-[rgba(209,208,208,0.2)]',
            className
          )}
          {...props}
        />
        {error && <p className="text-xs text-[#e87b7b]">{error}</p>}
      </div>
    )
  }
)
Textarea.displayName = 'Textarea'
