import React, { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { CheckCircle, AlertCircle, Info, AlertTriangle, X } from 'lucide-react'
import { cn } from '../../lib/utils'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

export interface ToastMessage {
  id: string
  type: ToastType
  title: string
  description?: string
  duration?: number
}

interface ToastProps {
  toast: ToastMessage
  onRemove: (id: string) => void
}

const icons = {
  success: <CheckCircle size={14} className="text-[#6dbf8c]" />,
  error: <AlertCircle size={14} className="text-[#e87b7b]" />,
  info: <Info size={14} className="text-[#7baee8]" />,
  warning: <AlertTriangle size={14} className="text-[#e8c07b]" />,
}

const borders = {
  success: 'border-[rgba(109,191,140,0.2)]',
  error: 'border-[rgba(232,123,123,0.2)]',
  info: 'border-[rgba(123,174,232,0.2)]',
  warning: 'border-[rgba(232,192,123,0.2)]',
}

const Toast: React.FC<ToastProps> = ({ toast, onRemove }) => {
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    timerRef.current = window.setTimeout(
      () => onRemove(toast.id),
      toast.duration ?? 4500
    )

    return () => {
      if (timerRef.current !== undefined) {
        window.clearTimeout(timerRef.current)
      }
    }
  }, [toast.id, toast.duration, onRemove])

  return (
    <div
      className={cn(
        'flex items-start gap-3 px-4 py-3 rounded-md min-w-[300px] max-w-[400px]',
        'bg-[#141414] border shadow-[0_8px_24px_rgba(0,0,0,0.6)]',
        'animate-slide-up',
        borders[toast.type]
      )}
      role="alert"
    >
      <span className="mt-0.5 shrink-0">{icons[toast.type]}</span>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-[#D1D0D0]">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-xs text-[rgba(209,208,208,0.5)]">{toast.description}</p>
        )}
      </div>
      <button
        onClick={() => onRemove(toast.id)}
        className="ml-2 p-0.5 text-[rgba(209,208,208,0.3)] hover:text-[#D1D0D0] transition-colors"
        aria-label="Dismiss"
      >
        <X size={12} />
      </button>
    </div>
  )
}

interface ToastContainerProps {
  toasts: ToastMessage[]
  onRemove: (id: string) => void
}

export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onRemove }) => {
  if (!toasts.length) return null
  return createPortal(
    <div
      className="fixed bottom-6 right-6 z-[100] flex flex-col gap-2"
      aria-live="assertive"
      aria-atomic="false"
    >
      {toasts.map(t => (
        <Toast key={t.id} toast={t} onRemove={onRemove} />
      ))}
    </div>,
    document.body
  )
}
