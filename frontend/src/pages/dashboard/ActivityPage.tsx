import React, { useEffect, useState } from 'react'
import { Share2, Download, ShieldOff, Clock, Shield, Upload, AlertCircle, Eye } from 'lucide-react'
import { AppSidebar } from '../../components/layout/AppSidebar'
import { Badge } from '../../components/ui/Badge'
import { formatRelativeTime } from '../../lib/utils'
import { apiListActivity, type ApiActivityLog } from '../../lib/api'

// Map backend event strings → display config
const eventConfig: Record<string, {
  icon: React.ReactNode
  iconClass: string
  badgeVariant: 'success' | 'info' | 'warning' | 'danger' | 'default' | 'muted'
  label: string
}> = {
  file_uploaded:          { icon: <Upload size={13} />,      iconClass: 'text-[rgba(209,208,208,0.6)]', badgeVariant: 'default',  label: 'Uploaded' },
  FILE_UPLOADED:          { icon: <Upload size={13} />,      iconClass: 'text-[rgba(209,208,208,0.6)]', badgeVariant: 'default',  label: 'Uploaded' },
  share_created:          { icon: <Share2 size={13} />,      iconClass: 'text-[#7baee8]',               badgeVariant: 'info',     label: 'Share created' },
  SHARE_CREATED:          { icon: <Share2 size={13} />,      iconClass: 'text-[#7baee8]',               badgeVariant: 'info',     label: 'Share created' },
  file_downloaded:        { icon: <Download size={13} />,    iconClass: 'text-[#6dbf8c]',               badgeVariant: 'success',  label: 'Downloaded' },
  FILE_DOWNLOADED:        { icon: <Download size={13} />,    iconClass: 'text-[#6dbf8c]',               badgeVariant: 'success',  label: 'Downloaded' },
  share_accessed:         { icon: <Shield size={13} />,      iconClass: 'text-[#7baee8]',               badgeVariant: 'info',     label: 'Accessed' },
  SHARE_ACCESSED:         { icon: <Shield size={13} />,      iconClass: 'text-[#7baee8]',               badgeVariant: 'info',     label: 'Accessed' },
  password_verified:      { icon: <Shield size={13} />,      iconClass: 'text-[#6dbf8c]',               badgeVariant: 'success',  label: 'Auth OK' },
  PASSWORD_VERIFIED:      { icon: <Shield size={13} />,      iconClass: 'text-[#6dbf8c]',               badgeVariant: 'success',  label: 'Auth OK' },
  password_failed:        { icon: <AlertCircle size={13} />, iconClass: 'text-[#e87b7b]',               badgeVariant: 'danger',   label: 'Auth failed' },
  PASSWORD_FAILED:        { icon: <AlertCircle size={13} />, iconClass: 'text-[#e87b7b]',               badgeVariant: 'danger',   label: 'Auth failed' },
  share_revoked:          { icon: <ShieldOff size={13} />,   iconClass: 'text-[#e87b7b]',               badgeVariant: 'danger',   label: 'Revoked' },
  SHARE_REVOKED:          { icon: <ShieldOff size={13} />,   iconClass: 'text-[#e87b7b]',               badgeVariant: 'danger',   label: 'Revoked' },
  share_expired:          { icon: <Clock size={13} />,       iconClass: 'text-[rgba(209,208,208,0.4)]', badgeVariant: 'muted',    label: 'Expired' },
  SHARE_EXPIRED:          { icon: <Clock size={13} />,       iconClass: 'text-[rgba(209,208,208,0.4)]', badgeVariant: 'muted',    label: 'Expired' },
  download_limit_reached: { icon: <Clock size={13} />,       iconClass: 'text-[#e8c07b]',               badgeVariant: 'warning',  label: 'Limit hit' },
  DOWNLOAD_LIMIT_REACHED: { icon: <Clock size={13} />,       iconClass: 'text-[#e8c07b]',               badgeVariant: 'warning',  label: 'Limit hit' },
  file_deleted:           { icon: <ShieldOff size={13} />,   iconClass: 'text-[rgba(209,208,208,0.4)]', badgeVariant: 'muted',    label: 'Deleted' },
  FILE_DELETED:           { icon: <ShieldOff size={13} />,   iconClass: 'text-[rgba(209,208,208,0.4)]', badgeVariant: 'muted',    label: 'Deleted' },
  VIEW_STARTED:           { icon: <Eye size={13} />,         iconClass: 'text-[#7baee8]',               badgeVariant: 'info',     label: 'View started' },
  VIEW_COMPLETED:         { icon: <Eye size={13} />,         iconClass: 'text-[#6dbf8c]',               badgeVariant: 'success',  label: 'View completed' },
  PRINT_BLOCKED:          { icon: <ShieldOff size={13} />,   iconClass: 'text-[#e87b7b]',               badgeVariant: 'danger',   label: 'Print blocked' },
  DOWNLOAD_BLOCKED:       { icon: <ShieldOff size={13} />,   iconClass: 'text-[#e87b7b]',               badgeVariant: 'danger',   label: 'DL blocked' },
}

const fallbackConfig = {
  icon: <Shield size={13} />,
  iconClass: 'text-[rgba(209,208,208,0.4)]',
  badgeVariant: 'muted' as const,
  label: 'Event',
}

function humanizeEvent(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export const ActivityPage: React.FC = () => {
  const [events, setEvents] = useState<ApiActivityLog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const load = async () => {
      try {
        const data = await apiListActivity(100)
        setEvents(data)
      } catch {/* ignore */}
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="flex min-h-screen bg-[#050505]">
      <AppSidebar />

      <main className="flex-1 min-w-0 lg:pt-0 pt-14">
        <div className="border-b border-[rgba(209,208,208,0.07)] px-6 md:px-8 py-6">
          <h1 className="text-base font-medium text-[#D1D0D0]">Activity</h1>
          <p className="mt-0.5 text-sm text-[rgba(209,208,208,0.4)]">Security event timeline</p>
        </div>

        <div className="px-6 md:px-8 py-8 max-w-3xl">
          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="w-6 h-6 border border-[rgba(209,208,208,0.2)] border-t-[rgba(209,208,208,0.6)] rounded-full animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-20 text-center">
              <Shield size={24} className="text-[rgba(209,208,208,0.2)] mb-3" />
              <p className="text-sm text-[rgba(209,208,208,0.4)]">Your security timeline is quiet.</p>
              <p className="mt-1 text-xs text-[rgba(209,208,208,0.25)]">Events will appear here as you use VaultKey.</p>
            </div>
          ) : (
            <div className="relative">
              <div
                className="absolute left-[18px] top-6 bottom-4 w-px"
                style={{ background: 'linear-gradient(to bottom, rgba(209,208,208,0.1), transparent)' }}
                aria-hidden="true"
              />
              <div className="space-y-1">
                {events.map((event) => {
                  const cfg = eventConfig[event.event] ?? fallbackConfig
                  return (
                    <div key={event.id} className="relative flex gap-5 pl-10 pb-4 group">
                      <div className={`absolute left-0 top-0.5 w-9 h-9 rounded-sm border border-[rgba(209,208,208,0.08)] bg-[#0d0d0d] flex items-center justify-center transition-colors duration-200 group-hover:border-[rgba(209,208,208,0.15)] ${cfg.iconClass}`}>
                        {cfg.icon}
                      </div>
                      <div className="flex-1 min-w-0 pt-0.5">
                        <div className="flex items-start justify-between gap-3 flex-wrap">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-0.5 flex-wrap">
                              <Badge variant={cfg.badgeVariant} size="sm">{cfg.label}</Badge>
                              {event.filename && (
                                <span className="text-[11px] font-mono text-[rgba(209,208,208,0.5)] truncate max-w-[200px]">
                                  {event.filename}
                                </span>
                              )}
                            </div>
                            <div className="flex items-center gap-3 flex-wrap">
                              <span className="text-[11px] font-mono text-[rgba(209,208,208,0.2)]">
                                {humanizeEvent(event.event)}
                              </span>
                              {event.ip_address && (
                                <span className="text-[11px] font-mono text-[rgba(209,208,208,0.2)]">
                                  {event.ip_address}
                                </span>
                              )}
                              {event.status && event.status !== 'OK' && (
                                <span className="text-[11px] font-mono text-[rgba(232,123,123,0.5)]">
                                  {event.status}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 text-[rgba(209,208,208,0.25)] shrink-0">
                            <Clock size={10} />
                            <span className="text-[11px]">{formatRelativeTime(event.timestamp)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
