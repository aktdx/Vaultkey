import React, { useState, useRef } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Shield, LayoutDashboard, Files, Share2, Activity, Settings, LogOut, ChevronLeft, Lock, Menu, X } from 'lucide-react'
import { cn } from '../../lib/utils'
import { useAuth } from '../../contexts/AuthContext'

interface NavItem {
  label: string
  href: string
  icon: React.ReactNode
}

const navItems: NavItem[] = [
  { label: 'Dashboard', href: '/dashboard', icon: <LayoutDashboard size={16} /> },
  { label: 'Files', href: '/dashboard/files', icon: <Files size={16} /> },
  { label: 'Shares', href: '/dashboard/shares', icon: <Share2 size={16} /> },
  { label: 'Activity', href: '/dashboard/activity', icon: <Activity size={16} /> },
  { label: 'Security', href: '/dashboard/security', icon: <Lock size={16} /> },
  { label: 'Settings', href: '/dashboard/settings', icon: <Settings size={16} /> },
]

export const AppSidebar: React.FC = () => {
  const { pathname } = useLocation()
  const { user, signOut } = useAuth()
  const [collapsed, setCollapsed] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? 'VK'

  const [emailTooltip, setEmailTooltip] = useState(false)
  const emailRef = useRef<HTMLDivElement>(null)

  const SidebarContent = () => (
    <div className="flex flex-col h-full">
      {/* Logo — navigates to dashboard */}
      <Link
        to="/dashboard"
        aria-label="Go to dashboard"
        className={cn(
          'flex items-center gap-3 px-5 py-5 border-b border-[rgba(209,208,208,0.07)] cursor-pointer hover:bg-[rgba(209,208,208,0.03)] transition-colors',
          collapsed && 'justify-center px-3'
        )}
        onClick={() => setMobileOpen(false)}
      >
        <Shield size={18} className="text-[#D1D0D0] shrink-0" />
        {!collapsed && (
          <span className="text-xs font-semibold tracking-[0.14em] uppercase text-[#D1D0D0]">VaultKey</span>
        )}
      </Link>

      {/* Nav */}
      <nav className="flex-1 py-4 px-2" aria-label="Dashboard navigation">
        {navItems.map(item => {
          const active = pathname === item.href || (item.href !== '/dashboard' && pathname.startsWith(item.href))
          return (
            <Link
              key={item.href}
              to={item.href}
              onClick={() => setMobileOpen(false)}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded text-sm transition-all duration-200 mb-0.5',
                active
                  ? 'bg-[rgba(209,208,208,0.09)] text-[#D1D0D0]'
                  : 'text-[rgba(209,208,208,0.45)] hover:text-[rgba(209,208,208,0.8)] hover:bg-[rgba(209,208,208,0.04)]',
                collapsed && 'justify-center px-2'
              )}
              title={collapsed ? item.label : undefined}
              aria-current={active ? 'page' : undefined}
            >
              <span className="shrink-0">{item.icon}</span>
              {!collapsed && <span>{item.label}</span>}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="border-t border-[rgba(209,208,208,0.07)] p-2">
        {/* User — hover tooltip shows full email */}
        <div
          ref={emailRef}
          className={cn('relative flex items-center gap-3 px-3 py-2.5 mb-1 rounded', collapsed && 'justify-center px-2')}
          onMouseEnter={() => setEmailTooltip(true)}
          onMouseLeave={() => setEmailTooltip(false)}
          onFocus={() => setEmailTooltip(true)}
          onBlur={() => setEmailTooltip(false)}
          tabIndex={0}
          aria-label={`Signed in as ${user?.email}`}
          role="status"
        >
          <div className="w-6 h-6 rounded-sm bg-[#2a2020] flex items-center justify-center text-[10px] font-medium text-[#988686] shrink-0">
            {initials}
          </div>
          {!collapsed && (
            <span className="text-xs text-[rgba(209,208,208,0.5)] truncate max-w-[120px]">
              {user?.email}
            </span>
          )}
          {/* Tooltip */}
          {emailTooltip && user?.email && (
            <div
              className="absolute bottom-full left-2 mb-2 z-50 px-3 py-2 rounded bg-[#1a1a1a] border border-[rgba(209,208,208,0.15)] text-xs text-[#D1D0D0] whitespace-nowrap shadow-lg pointer-events-none"
              role="tooltip"
            >
              {user.email}
              <div className="absolute top-full left-4 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-[#1a1a1a]" />
            </div>
          )}
        </div>

        {/* Sign out */}
        <button
          onClick={() => signOut()}
          className={cn(
            'flex items-center gap-3 w-full px-3 py-2.5 rounded text-sm text-[rgba(209,208,208,0.35)] hover:text-[rgba(209,208,208,0.7)] hover:bg-[rgba(209,208,208,0.04)] transition-all duration-200',
            collapsed && 'justify-center px-2'
          )}
          title={collapsed ? 'Sign out' : undefined}
        >
          <LogOut size={14} className="shrink-0" />
          {!collapsed && <span>Sign out</span>}
        </button>
      </div>
    </div>
  )

  return (
    <>
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'hidden lg:flex flex-col fixed left-0 top-0 bottom-0 z-30',
          'bg-[#080808] border-r border-[rgba(209,208,208,0.07)]',
          'transition-all duration-300',
          collapsed ? 'w-14' : 'w-52'
        )}
      >
        <SidebarContent />
        {/* Collapse button */}
        <button
          onClick={() => setCollapsed(!collapsed)}
          className="absolute -right-3 top-8 w-6 h-6 rounded-full bg-[#1a1a1a] border border-[rgba(209,208,208,0.12)] flex items-center justify-center text-[rgba(209,208,208,0.5)] hover:text-[#D1D0D0] transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <ChevronLeft size={12} className={cn('transition-transform duration-300', collapsed && 'rotate-180')} />
        </button>
      </aside>

      {/* Mobile top bar */}
      <div className="lg:hidden fixed top-0 left-0 right-0 z-30 bg-[#080808] border-b border-[rgba(209,208,208,0.07)] h-14 flex items-center justify-between px-4">
        <Link to="/dashboard" className="flex items-center gap-2" aria-label="Go to dashboard">
          <Shield size={16} className="text-[#D1D0D0]" />
          <span className="text-xs font-semibold tracking-[0.14em] uppercase text-[#D1D0D0]">VaultKey</span>
        </Link>
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 text-[rgba(209,208,208,0.6)]"
          aria-label="Toggle navigation"
        >
          {mobileOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile drawer */}
      {mobileOpen && (
        <div
          className="lg:hidden fixed inset-0 z-40"
          onClick={() => setMobileOpen(false)}
        >
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
          <aside
            className="absolute left-0 top-0 bottom-0 w-64 bg-[#080808] border-r border-[rgba(209,208,208,0.08)]"
            onClick={e => e.stopPropagation()}
          >
            <SidebarContent />
          </aside>
        </div>
      )}

      {/* Sidebar spacer for desktop layout */}
      <div
        className={cn(
          'hidden lg:block shrink-0 transition-all duration-300',
          collapsed ? 'w-14' : 'w-52'
        )}
      />
    </>
  )
}
