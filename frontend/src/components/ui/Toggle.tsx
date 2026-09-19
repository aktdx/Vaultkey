import React from 'react'
import { cn } from '../../lib/utils'

interface ToggleProps {
  checked: boolean
  onChange: (checked: boolean) => void
  label?: string
  description?: string
  disabled?: boolean
  size?: 'sm' | 'md'
}

export const Toggle: React.FC<ToggleProps> = ({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  size = 'md',
}) => {
  const trackSize = size === 'sm' ? 'w-8 h-4' : 'w-10 h-5'
  const thumbSize = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'
  const thumbTranslate = size === 'sm' ? 'translate-x-4' : 'translate-x-5'

  return (
    <label className={cn('flex items-start gap-3', disabled && 'opacity-40 cursor-not-allowed', !disabled && 'cursor-pointer')}>
      <div className={cn('relative shrink-0 mt-0.5', trackSize)}>
        <input
          type="checkbox"
          checked={checked}
          onChange={e => onChange(e.target.checked)}
          disabled={disabled}
          className="sr-only"
        />
        <div
          className={cn(
            'absolute inset-0 rounded-full transition-colors duration-200',
            checked ? 'bg-[#D1D0D0]' : 'bg-[rgba(209,208,208,0.15)]'
          )}
        />
        <div
          className={cn(
            'absolute top-[3px] left-[3px] rounded-full bg-white transition-transform duration-200',
            thumbSize,
            checked ? thumbTranslate : 'translate-x-0'
          )}
        />
      </div>
      {(label || description) && (
        <div>
          {label && <p className="text-sm text-[#D1D0D0] leading-tight">{label}</p>}
          {description && <p className="mt-0.5 text-xs text-[rgba(209,208,208,0.45)]">{description}</p>}
        </div>
      )}
    </label>
  )
}
