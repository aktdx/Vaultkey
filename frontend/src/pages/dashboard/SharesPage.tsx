import React, { useEffect, useState } from 'react'
import { Search, ShieldOff, Copy, Link2, Check, Plus } from 'lucide-react'
import { AppSidebar } from '../../components/layout/AppSidebar'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { SecurityBadge, Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { useToast } from '../../contexts/ToastContext'
import { formatDate, formatRelativeTime } from '../../lib/utils'
import { listShares, revokeShare } from '../../lib/shares'
import type { ApiShareDetail } from '../../lib/api'

type ShareStatus = 'active' | 'expired' | 'revoked' | 'limit_reached'

function getShareStatus(share: ApiShareDetail): ShareStatus {
  if (share.revoked) return 'revoked'
  if (share.status === 'LIMIT_REACHED') return 'limit_reached'
  if (share.status === 'EXPIRED') return 'expired'
  return 'active'
}

export const SharesPage: React.FC = () => {
  const [shares, setShares] = useState<ApiShareDetail[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [revokeId, setRevokeId] = useState<string | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const toast = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const data = await listShares()
      setShares(data)
    } catch (e) {
      toast('error', 'Failed to load shares', e instanceof Error ? e.message : '')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleCopy = async (share: ApiShareDetail) => {
    // The share list only has the share UUID, not the raw high-entropy token
    // (the backend only stores token_hash). The full link with token was shown
    // once in the CreateShareModal at creation time.
    // We copy a best-effort link: /s/{id} won't resolve, so we alert the user.
    const msg = `Share ID: ${share.id}\n\nThe full share URL (with access token) was shown once when you created this share.\nFor security, the raw token is not stored — copy it from the creation dialog.`
    try {
      await navigator.clipboard.writeText(msg)
    } catch {/* ignore */}
    setCopiedId(share.id)
    setTimeout(() => setCopiedId(null), 2000)
    toast('warning', 'Token not recoverable', 'The access token was shown once at creation time and is not stored. Copy the link immediately after creating shares.')
  }

  const handleRevoke = async () => {
    if (!revokeId) return
    setRevoking(true)
    try {
      await revokeShare(revokeId, '')
      setShares(prev => prev.map(s => s.id === revokeId ? { ...s, revoked: true, status: 'REVOKED' as const } : s))
      toast('success', 'Share revoked', 'The link is now permanently inaccessible.')
    } catch (e) {
      toast('error', 'Revoke failed', e instanceof Error ? e.message : '')
    } finally {
      setRevoking(false)
      setRevokeId(null)
    }
  }

  const filtered = shares.filter(s =>
    s.original_filename.toLowerCase().includes(search.toLowerCase())
  )

  const activeCount = shares.filter(s => !s.revoked && s.status === 'ACTIVE').length

  return (
    <div className="flex min-h-screen bg-[#050505]">
      <AppSidebar />

      <main className="flex-1 min-w-0 lg:pt-0 pt-14">
        <div className="border-b border-[rgba(209,208,208,0.07)] px-6 md:px-8 py-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-base font-medium text-[#D1D0D0]">Shares</h1>
              <p className="mt-0.5 text-sm text-[rgba(209,208,208,0.4)]">
                {loading ? 'Loading…' : `${activeCount} active link${activeCount !== 1 ? 's' : ''}`}
              </p>
            </div>
            <Button
              variant="secondary"
              size="sm"
              leftIcon={<Plus size={13} />}
              onClick={() => toast('info', 'Create shares from the Files page', 'Open the Files tab and click the share icon next to any file.')}
            >
              New share
            </Button>
          </div>
        </div>

        <div className="px-6 md:px-8 py-6 max-w-6xl space-y-4">
          <div className="max-w-sm">
            <Input
              placeholder="Search shares…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              leftIcon={<Search size={14} />}
            />
          </div>

          <div className="border border-[rgba(209,208,208,0.08)] rounded-md bg-[#0a0a0a] overflow-hidden">
            {loading ? (
              <div className="flex items-center justify-center py-20">
                <div className="w-6 h-6 border border-[rgba(209,208,208,0.2)] border-t-[rgba(209,208,208,0.6)] rounded-full animate-spin" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <Link2 size={24} className="text-[rgba(209,208,208,0.2)] mb-3" />
                <p className="text-sm text-[rgba(209,208,208,0.4)]">No active secure links.</p>
                <p className="mt-1 text-xs text-[rgba(209,208,208,0.25)]">Go to Files and click the share icon to create one.</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="vault-table">
                  <thead>
                    <tr>
                      <th>File</th>
                      <th>Status</th>
                      <th>Mode</th>
                      <th>Downloads</th>
                      <th>Protection</th>
                      <th>Expires</th>
                      <th>Created</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(share => {
                      const status = getShareStatus(share)
                      return (
                        <tr key={share.id}>
                          <td>
                            <div className="max-w-[200px]">
                              <p className="text-[#D1D0D0] text-xs font-medium truncate">{share.original_filename}</p>
                            </div>
                          </td>
                          <td>
                            <SecurityBadge status={status === 'limit_reached' ? 'expired' : status} />
                          </td>
                          <td>
                            {share.access_mode === 'view_only' ? (
                              <Badge variant="warning" size="sm">View only</Badge>
                            ) : (
                              <Badge variant="default" size="sm">Download</Badge>
                            )}
                          </td>
                          <td>
                            <span className="text-xs text-[rgba(209,208,208,0.6)]">
                              {share.download_count}
                              {share.max_downloads > 0 && ` / ${share.max_downloads}`}
                            </span>
                          </td>
                          <td>
                            {share.has_password ? (
                              <Badge variant="info" size="sm">Password</Badge>
                            ) : (
                              <span className="text-xs text-[rgba(209,208,208,0.3)]">None</span>
                            )}
                          </td>
                          <td className="text-xs text-[rgba(209,208,208,0.4)]">
                            {share.expires_at ? formatDate(share.expires_at) : '—'}
                          </td>
                          <td className="text-xs text-[rgba(209,208,208,0.4)]">
                            {formatRelativeTime(share.created_at)}
                          </td>
                          <td>
                            <div className="flex items-center gap-1 justify-end">
                              {status === 'active' && (
                                <>
                                  <button
                                    onClick={() => handleCopy(share)}
                                    className="p-1.5 rounded text-[rgba(209,208,208,0.3)] hover:text-[rgba(209,208,208,0.7)] hover:bg-[rgba(209,208,208,0.06)] transition-all"
                                    title="Copy link"
                                  >
                                    {copiedId === share.id
                                      ? <Check size={13} className="text-[#6dbf8c]" />
                                      : <Copy size={13} />}
                                  </button>
                                  <button
                                    onClick={() => setRevokeId(share.id)}
                                    className="p-1.5 rounded text-[rgba(232,123,123,0.4)] hover:text-[#e87b7b] hover:bg-[rgba(232,123,123,0.06)] transition-all"
                                    title="Revoke"
                                  >
                                    <ShieldOff size={13} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </main>

      <Modal
        open={!!revokeId}
        onClose={() => !revoking && setRevokeId(null)}
        title="Revoke share link"
        description="This action is permanent. The link will immediately become inaccessible."
        size="sm"
      >
        <div className="flex gap-3 mt-2">
          <Button variant="secondary" size="md" className="flex-1" onClick={() => setRevokeId(null)} disabled={revoking}>
            Cancel
          </Button>
          <Button variant="danger" size="md" className="flex-1" onClick={handleRevoke} loading={revoking}>
            Revoke access
          </Button>
        </div>
      </Modal>
    </div>
  )
}
