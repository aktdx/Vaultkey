import React, { createContext, useCallback, useContext, useState } from 'react'
import { ToastContainer } from '../components/ui/Toast'
import type { ToastMessage, ToastType } from '../components/ui/Toast'
import { generateId } from '../lib/utils'

interface ToastContextType {
  toast: (type: ToastType, title: string, description?: string, duration?: number) => void
}

const ToastContext = createContext<ToastContextType | null>(null)

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  const removeToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  const toast = useCallback((
    type: ToastType,
    title: string,
    description?: string,
    duration?: number
  ) => {
    const id = generateId(8)
    setToasts(prev => [...prev, { id, type, title, description, duration }])
  }, [])

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  )
}

export function useToast() {
  const ctx = useContext(ToastContext)
  if (!ctx) throw new Error('useToast must be used within ToastProvider')
  return ctx.toast
}
