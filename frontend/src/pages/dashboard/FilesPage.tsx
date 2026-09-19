import React, { useEffect, useState } from 'react'
import { Upload, Search, Lock, Trash2, Share2 } from 'lucide-react'
import { AppSidebar } from '../../components/layout/AppSidebar'
import { Button } from '../../components/ui/Button'
import { Input } from '../../components/ui/Input'
import { Badge } from '../../components/ui/Badge'
import { Modal } from '../../components/ui/Modal'
import { FileUpload } from '../../components/upload/FileUpload'
import { CreateShareModal } from '../../components/shares/CreateShareModal'
import { formatBytes, formatRelativeTime } from '../../lib/utils'
import { listFiles, deleteFile } from '../../lib/files'
import type { ApiFile } from '../../lib/api'
import { useToast } from '../../contexts/ToastContext'

const fileExtIcon = (mime: string) => {
  if (mime.includes('pdf')) return '📄'
  if (mime.includes('zip') || mime.includes('gzip') || mime.includes('tar')) return '🗜'
  if (mime.includes('doc') || mime.includes('word')) return '📝'
  if (mime.startsWith('image/')) return '🖼'
  return '📁'
}

export const FilesPage: React.FC = () => {
  const [files, setFiles] = useState<ApiFile[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [uploadOpen, setUploadOpen] = useState(false)
  const [shareFileId, setShareFileId] = useState<string | null>(null)
  // Encryption key captured from upload — passed to CreateShareModal so the
  // full #key= URL is built automatically (zero-knowledge delivery).
  const [pendingKey, setPendingKey] = useState<string | undefined>(undefined)
  const toast = useToast()

  const load = async () => {
    setLoading(true)
    try {
      const data = await listFiles()
      setFiles(data)
    } catch (e) {
      toast('error', 'Failed to load files', e instanceof Error ? e.message : '')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const handleDelete = async (file: ApiFile) => {
    if (!confirm(`Delete "${file.original_filename}"? This also removes all shares for this file.`)) return
    try {
      await deleteFile(file.id, file.id)
      setFiles(prev => prev.filter(f => f.id !== file.id))
      toast('success', 'File deleted')
    } catch (e) {
      toast('error', 'Delete failed', e instanceof Error ? e.message : '')
    }
  }

  // Called by FileUpload once a file finishes encrypting + uploading.
  // Close the upload modal, refresh the list, then immediately open the
  // share-creation modal pre-seeded with the file id and encryption key.
  const handleUploadComplete = (fileId: string, encryptionKey: string) => {
    setUploadOpen(false)
    load()
    setPendingKey(encryptionKey)
    setShareFileId(fileId)
  }

  const filtered = files.filter(f =>
    f.original_filename.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <div className="flex min-h-screen bg-[#050505]">
      <AppSidebar />

      <main className="flex-1 min-w-0 lg:pt-0 pt-14">
        {/* Header */}
        <div className="border-b border-[rgba(209,208,208,0.07)] px-6 md:px-8 py-6">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <h1 className="text-base font-medium text-[#D1D0D0]">Files</h1>
              <p className="mt-0.5 text-sm text-[rgba(209,208,208,0.4)]">
                {loading ? 'Loading…' : `${files.length} encrypted file${files.length !== 1 ? 's' : ''}`}
              </p>
            </div>
            <Button variant="primary" size="sm" leftIcon={<Upload size={13} />} onClick={() => setUploadOpen(true)}>
              Upload file
            </Button>
          </div>
        </div>

        <div className="px-6 md:px-8 py-6 max-w-6xl space-y-4">
          <div className="max-w-sm">
            <Input
              placeholder="Search files…"
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
                <Lock size={24} className="text-[rgba(209,208,208,0.2)] mb-3" />
                <p className="text-sm text-[rgba(209,208,208,0.4)]">
                  {search ? 'No files match your search.' : 'Your secure workspace is empty.'}
                </p>
                {!search && (
                  <Button variant="secondary" size="sm" className="mt-4" onClick={() => setUploadOpen(true)}>
                    Upload your first file
                  </Button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="vault-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Size</th>
                      <th>Encrypted</th>
                      <th>Shares</th>
                      <th>Downloads</th>
                      <th>Uploaded</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map(file => (
                      <tr key={file.id}>
                        <td>
                          <div className="flex items-center gap-3">
                            <span className="text-base" aria-hidden="true">{fileExtIcon(file.mime_type)}</span>
                            <span className="font-medium text-[#D1D0D0] max-w-[240px] truncate">{file.original_filename}</span>
                          </div>
                        </td>
                        <td className="font-mono text-xs">{formatBytes(file.size)}</td>
                        <td>
                          <div className="flex items-center gap-1.5">
                            <Lock size={11} className="text-[#6dbf8c]" />
                            <span className="text-[11px] text-[rgba(109,191,140,0.7)]">AES-256</span>
                          </div>
                        </td>
                        <td>
                          {file.active_shares_count > 0 ? (
                            <Badge variant="info" size="sm">{file.active_shares_count} active</Badge>
                          ) : (
                            <span className="text-xs text-[rgba(209,208,208,0.3)]">—</span>
                          )}
                        </td>
                        <td className="text-xs text-[rgba(209,208,208,0.6)]">{file.total_downloads}</td>
                        <td className="text-xs text-[rgba(209,208,208,0.4)]">{formatRelativeTime(file.created_at)}</td>
                        <td>
                          <div className="flex items-center gap-1 justify-end">
                            <button
                              className="p-1.5 rounded text-[rgba(209,208,208,0.3)] hover:text-[rgba(209,208,208,0.7)] hover:bg-[rgba(209,208,208,0.06)] transition-all"
                              title="Create share"
                              onClick={() => { setPendingKey(undefined); setShareFileId(file.id) }}
                            >
                              <Share2 size={13} />
                            </button>
                            <button
                              className="p-1.5 rounded text-[rgba(232,123,123,0.4)] hover:text-[#e87b7b] hover:bg-[rgba(232,123,123,0.06)] transition-all"
                              title="Delete"
                              onClick={() => handleDelete(file)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
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

      {/* Create share modal — opened automatically after upload (with key)
          or manually from the table Share button (without key → shows paste input) */}
      {shareFileId && (
        <CreateShareModal
          fileId={shareFileId}
          encryptionKey={pendingKey}
          onClose={() => {
            setShareFileId(null)
            setPendingKey(undefined)
            load()
          }}
        />
      )}
    </div>
  )
}
