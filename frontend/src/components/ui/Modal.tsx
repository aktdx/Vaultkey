import React, { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { cn } from '../../lib/utils'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: string
  description?: string
  size?: 'sm' | 'md' | 'lg' | 'xl'
  children: React.ReactNode
  className?: string
}

export const Modal: React.FC<ModalProps> = ({
  open,
  onClose,
  title,
  description,
  size = 'md',
  children,
  className,
}) => {
  const [visible, setVisible] = useState(false)
  const overlayRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (open) {
      setVisible(true)
      document.body.style.overflow = 'hidden'
    } else {
      const t = setTimeout(() => setVisible(false), 250)
      document.body.style.overflow = ''
      return () => clearTimeout(t)
    }
    return () => { document.body.style.overflow = '' }
  }, [open])

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [open, onClose])

  if (!visible) return null

  const sizes = {
    sm: 'max-w-sm',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  }

  return createPortal(
    <div
      ref={overlayRef}
      className={cn(
        'fixed inset-0 z-50 flex items-center justify-center p-4',
        'bg-black/70 backdrop-blur-sm',
        'transition-opacity duration-250',
        open ? 'opacity-100' : 'opacity-0'
      )}
      onClick={e => { if (e.target === overlayRef.current) onClose() }}
      role="dialog"
      aria-modal="true"
      aria-labelledby={title ? 'modal-title' : undefined}
    >
      <div
        className={cn(
          'w-full rounded-lg border border-[rgba(209,208,208,0.1)] bg-[#0d0d0d]',
          'shadow-[0_24px_64px_rgba(0,0,0,0.8)]',
          'transition-all duration-250',
          open ? 'opacity-100 scale-100 translate-y-0' : 'opacity-0 scale-95 translate-y-4',
          sizes[size],
          className
        )}
      >
        {(title || description) && (
          <div className="flex items-start justify-between px-6 py-5 border-b border-[rgba(209,208,208,0.08)]">
            <div>
              {title && (
                <h2 id="modal-title" className="text-base font-medium text-[#D1D0D0]">{title}</h2>
              )}
              {description && (
                <p className="mt-1 text-sm text-[rgba(209,208,208,0.5)]">{description}</p>
              )}
            </div>
            <button
              onClick={onClose}
              className="ml-4 p-1 rounded text-[rgba(209,208,208,0.4)] hover:text-[#D1D0D0] hover:bg-[rgba(209,208,208,0.08)] transition-colors"
              aria-label="Close"
            >
              <X size={16} />
            </button>
          </div>
        )}
        <div className="px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body
  )
}
