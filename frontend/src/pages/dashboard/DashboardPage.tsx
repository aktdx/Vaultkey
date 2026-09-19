import React, { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  Upload, Files, Share2, Activity, Shield,
  ArrowUpRight, TrendingUp, Download, Clock
} from 'lucide-react'
import { AppSidebar } from '../../components/layout/AppSidebar'
import { Button } from '../../components/ui/Button'
import { FileUpload } from '../../components/upload/FileUpload'
import { Modal } from '../../components/ui/Modal'
import { Badge } from '../../components/ui/Badge'
import { CreateShareModal } from '../../components/shares/CreateShareModal'
import { useAuth } from '../../contexts/AuthContext'
import { formatRelativeTime } from '../../lib/utils'
import { apiListFiles, apiListShares, apiListActivity, type ApiActivityLog } from '../../lib/api'

interface StatCardProps {
  label: string
  value: string | number
  sub?: string
  icon: React.ReactNode
  trend?: string
  loading?: boolean
}

const StatCard: React.FC<StatCardProps> = ({ label, value, sub, icon, trend, loading }) => (
  <div className="border border-[rgba(209,208,208,0.08)] rounded-md bg-[#0a0a0a] p-5">
    <div className="flex items-start justify-between mb-4">
      <span className="text-[10px] font-medium tracking-[0.1em] uppercase text-[rgba(209,208,208,0.4)]">{label}</span>
      <span className="text-[rgba(209,208,208,0.3)]">{icon}</span>
    </div>
    <div className="flex items-end justify-between">
      <div>
        {loading ? (
          <div className="h-7 w-12 rounded bg-[rgba(209,208,208,0.06)] animate-pulse" />
        ) : (
          <p className="text-2xl font-semibold text-[#D1D0D0] tracking-tight">{value}</p>
        )}
        {sub && <p className="mt-1 text-xs text-[rgba(209,208,208,0.35)]">{sub}</p>}
      </div>
      {trend && !loading && (
        <div className="flex items-center gap-1 text-[#6dbf8c]">
          <TrendingUp size={11} />
          <span className="text-[10px]">{trend}</span>
        </div>
      )}
    </div>
  </div>
)

const activityEventColors: Record<string, string> = {
  FILE_UPLOADED: 'text-[rgba(209,208,208,0.5)]',
  file_uploaded: 'text-[rgba(209,208,208,0.5)]',
  SHARE_CREATED: 'text-[#7baee8]',
  share_created: 'text-[#7baee8]',
  FILE_DOWNLOADED: 'text-[#6dbf8c]',
  file_downloaded: 'text-[#6dbf8c]',
  SHARE_REVOKED: 'text-[#e87b7b]',
  share_revoked: 'text-[#e87b7b]',
  PASSWORD_FAILED: 'text-[#e87b7b]',
  password_failed: 'text-[#e87b7b]',
}

function activityIcon(event: string): React.ReactNode {
  const key = event.toUpperCase()
  if (key.includes('DOWNLOAD')) return <Download size={13} />
  if (key.includes('SHARE')) return <Share2 size={13} />
  if (key.includes('UPLOAD')) return <Upload size={13} />
  if (key.includes('REVOK') || key.includes('FAIL') || key.includes('BLOCK')) return <Shield size={13} />
  return <Activity size={13} />
}

function humanLabel(event: string): string {
  return event
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase())
}

export const DashboardPage: React.FC = () => {
  const [uploadOpen, setUploadOpen] = useState(false)
  const [shareFileId, setShareFileId] = useState<string | null>(null)
  const [pendingKey, setPendingKey] = useState<string | undefined>(undefined)
  const [statsLoading, setStatsLoading] = useState(true)
  const [totalFiles, setTotalFiles] = useState(0)
  const [activeShares, setActiveShares] = useState(0)
  const [totalDownloads, setTotalDownloads] = useState(0)
  const [recentActivity, setRecentActivity] = useState<ApiActivityLog[]>([])
  const { user } = useAuth()

  useEffect(() => {
    const load = async () => {
      setStatsLoading(true)
      try {
        const [files, shares, activity] = await Promise.all([
          apiListFiles(),
          apiListShares(),
          apiListActivity(5),
        ])

        setTotalFiles(files.length)
        setTotalDownloads(files.reduce((sum, f) => sum + f.total_downloads, 0))
        setActiveShares(shares.filter(s => !s.revoked && s.status === 'ACTIVE').length)
        setRecentActivity(activity)
      } catch {
        // Non-critical — stats will show 0
      } finally {
        setStatsLoading(false)
      }
    }
    load()
  }, [])

  const greeting = () => {
    const h = new Date().getHours()
    if (h < 12) return 'Good morning'
    if (h < 17) return 'Good afternoon'
    return 'Good evening'
  }

  // After upload: close the upload modal, refresh stats, open share modal
  // with the encryption key so the full #key= URL is built automatically.
  const handleUploadComplete = (fileId: string, encryptionKey: string) => {
    setUploadOpen(false)
    apiListFiles().then(files => {
      setTotalFiles(files.length)
      setTotalDownloads(files.reduce((sum, f) => sum + f.total_downloads, 0))
    }).catch(() => {})
    setPendingKey(encryptionKey)
    setShareFileId(fileId)
  }

  return (
    <div className="flex min-h-screen bg-[#050505]">
      <AppSidebar />

      <main className="flex-1 min-w-0 lg:pt-0 pt-14">
        {/* Header */}
        <div className="border-b border-[rgba(209,208,208,0.07)] px-6 md:px-8 py-6">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-base font-medium text-[#D1D0D0]">
                {greeting()}
              </h1>
              <p className="mt-0.5 text-sm text-[rgba(209,208,208,0.4)]">
                {user?.email}
              </p>
            </div>
            <Button
              variant="primary"
              size="sm"
              leftIcon={<Upload size={13} />}
              onClick={() => setUploadOpen(true)}
            >
              Secure file
            </Button>
          </div>
        </div>

        <div className="px-6 md:px-8 py-8 space-y-8 max-w-6xl">
          {/* Stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard
              label="Total files"
              value={totalFiles}
              sub={totalFiles === 1 ? '1 encrypted file' : `${totalFiles} encrypted files`}
              icon={<Files size={15} />}
              loading={statsLoading}
            />
            <StatCard
              label="Active shares"
              value={activeShares}
              sub={activeShares === 1 ? '1 active link' : `${activeShares} active links`}
              icon={<Share2 size={15} />}
              loading={statsLoading}
            />
            <StatCard
              label="Downloads"
              value={totalDownloads}
              sub="All time"
              icon={<Download size={15} />}
              loading={statsLoading}
            />
            <StatCard
              label="Security status"
              value="Secure"
              sub="AES-256-GCM active"
              icon={<Shield size={15} />}
            />
          </div>

          {/* Two-column layout */}
          <div className="grid lg:grid-cols-5 gap-6">
            {/* Recent activity */}
            <div className="lg:col-span-3 border border-[rgba(209,208,208,0.08)] rounded-md bg-[#0a0a0a]">
              <div className="flex items-center justify-between px-5 py-4 border-b border-[rgba(209,208,208,0.06)]">
                <h2 className="text-sm font-medium text-[#D1D0D0]">Recent activity</h2>
                <Link to="/dashboard/activity">
                  <Button variant="ghost" size="sm" rightIcon={<ArrowUpRight size={12} />}>
                    View all
                  </Button>
                </Link>
              </div>
              {statsLoading ? (
                <div className="divide-y divide-[rgba(209,208,208,0.05)]">
                  {[1, 2, 3].map(i => (
                    <div key={i} className="flex items-center gap-4 px-5 py-3.5">
                      <div className="w-5 h-5 rounded bg-[rgba(209,208,208,0.06)] animate-pulse shrink-0" />
                      <div className="flex-1 space-y-1.5">
                        <div className="h-3 w-32 rounded bg-[rgba(209,208,208,0.06)] animate-pulse" />
                        <div className="h-2.5 w-20 rounded bg-[rgba(209,208,208,0.04)] animate-pulse" />
                      </div>
                    </div>
                  ))}
                </div>
              ) : recentActivity.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-10 text-center">
                  <p className="text-xs text-[rgba(209,208,208,0.3)]">No activity yet.</p>
                </div>
              ) : (
                <div className="divide-y divide-[rgba(209,208,208,0.05)]">
                  {recentActivity.map(item => {
                    const colorClass = activityEventColors[item.event] ?? 'text-[rgba(209,208,208,0.4)]'
                    return (
                      <div key={item.id} className="flex items-center gap-4 px-5 py-3.5 hover:bg-[rgba(209,208,208,0.02)] transition-colors">
                        <div className={`shrink-0 ${colorClass}`}>
                          {activityIcon(item.event)}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs text-[rgba(209,208,208,0.7)]">{humanLabel(item.event)}</p>
                          {item.filename && (
                            <p className="text-[11px] text-[rgba(209,208,208,0.35)] truncate">{item.filename}</p>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 text-[rgba(209,208,208,0.3)] shrink-0">
                          <Clock size={10} />
                          <span className="text-[11px]">{formatRelativeTime(item.timestamp)}</span>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>

            {/* Quick actions */}
            <div className="lg:col-span-2 space-y-4">
              <div className="border border-[rgba(209,208,208,0.08)] rounded-md bg-[#0a0a0a] p-5">
                <h2 className="text-sm font-medium text-[#D1D0D0] mb-4">Quick actions</h2>
                <div className="space-y-2">
                  {[
                    { label: 'Upload & encrypt file', icon: <Upload size={14} />, action: () => setUploadOpen(true) },
                    { label: 'Manage files', icon: <Files size={14} />, href: '/dashboard/files' },
                    { label: 'Active shares', icon: <Share2 size={14} />, href: '/dashboard/shares' },
                    { label: 'Activity log', icon: <Activity size={14} />, href: '/dashboard/activity' },
                  ].map(action => (
                    action.href ? (
                      <Link
                        key={action.label}
                        to={action.href}
                        className="flex items-center gap-3 px-3 py-2.5 rounded border border-transparent hover:border-[rgba(209,208,208,0.1)] hover:bg-[rgba(209,208,208,0.03)] transition-all duration-200 text-sm text-[rgba(209,208,208,0.6)] hover:text-[#D1D0D0]"
                      >
                        <span className="text-[rgba(209,208,208,0.4)]">{action.icon}</span>
                        {action.label}
                        <ArrowUpRight size={11} className="ml-auto opacity-40" />
                      </Link>
                    ) : (
                      <button
                        key={action.label}
                        onClick={action.action}
                        className="flex items-center gap-3 px-3 py-2.5 rounded border border-transparent hover:border-[rgba(209,208,208,0.1)] hover:bg-[rgba(209,208,208,0.03)] transition-all duration-200 text-sm text-[rgba(209,208,208,0.6)] hover:text-[#D1D0D0] w-full text-left"
                      >
                        <span className="text-[rgba(209,208,208,0.4)]">{action.icon}</span>
                        {action.label}
                      </button>
                    )
                  ))}
                </div>
              </div>

              {/* Security status */}
              <div className="border border-[rgba(209,208,208,0.08)] rounded-md bg-[#0a0a0a] p-5">
                <div className="flex items-center gap-2 mb-3">
                  <div className="relative w-2 h-2">
                    <div className="w-2 h-2 rounded-full bg-[#6dbf8c]" />
                    <div className="absolute inset-0 rounded-full bg-[#6dbf8c] animate-ping opacity-30" />
                  </div>
                  <span className="text-xs font-medium tracking-wide text-[rgba(209,208,208,0.6)]">Security status</span>
                </div>
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[rgba(209,208,208,0.4)]">Encryption</span>
                    <span className="text-[11px] text-[rgba(109,191,140,0.7)]">AES-256-GCM active</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[rgba(209,208,208,0.4)]">Files</span>
                    <span className="text-[11px] text-[rgba(109,191,140,0.7)]">{statsLoading ? '…' : `${totalFiles} encrypted`}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[rgba(209,208,208,0.4)]">Active shares</span>
                    <span className="text-[11px] text-[rgba(109,191,140,0.7)]">{statsLoading ? '…' : `${activeShares} links`}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-xs text-[rgba(209,208,208,0.4)]">Key storage</span>
                    <Badge variant="warning" size="sm">Client-side only</Badge>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* Upload modal */}
      <Modal
        open={uploadOpen}
        onClose={() => setUploadOpen(false)}
        title="Secure file upload"
        description="Files are encrypted in your browser before upload using AES-256-GCM."
        size="md"
      >
        <FileUpload onUploadComplete={handleUploadComplete} />
      </Modal>

      {/* Create share modal — opens automatically after upload with the key pre-seeded */}
      {shareFileId && (
        <CreateShareModal
          fileId={shareFileId}
          encryptionKey={pendingKey}
          onClose={() => {
            setShareFileId(null)
            setPendingKey(undefined)
          }}
        />
      )}
    </div>
  )
}
