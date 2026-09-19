import React, { useCallback, useRef, useState } from 'react'
import { Upload, Lock, Shield, CheckCircle, AlertCircle, X, FileText } from 'lucide-react'
import { cn, formatBytes, generateId } from '../../lib/utils'
import { uploadFile } from '../../lib/files'
import { useAuth } from '../../contexts/AuthContext'

export type UploadStage =
  | 'idle'
  | 'selected'
  | 'encrypting'
  | 'uploading'
  | 'complete'
  | 'error'

interface UploadedFile {
  id: string
  file: File
  stage: UploadStage
  progress: number
  error?: string
  encryptionKey?: string
  storagePath?: string
}

interface FileUploadProps {
  onUploadComplete?: (fileId: string, encryptionKey: string, fileName: string) => void
  maxSizeBytes?: number
}

const stageLabels: Record<UploadStage, string> = {
  idle: '',
  selected: 'Ready',
  encrypting: 'Encrypting',
  uploading: 'Uploading',
  complete: 'Secured',
  error: 'Failed',
}

const STAGE_STEPS: UploadStage[] = ['selected', 'encrypting', 'uploading', 'complete']

export const FileUpload: React.FC<FileUploadProps> = ({
  onUploadComplete,
  maxSizeBytes = 100 * 1024 * 1024, // 100 MB
}) => {
  const [uploads, setUploads] = useState<UploadedFile[]>([])
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const updateUpload = (id: string, update: Partial<UploadedFile>) => {
    setUploads(prev => prev.map(u => u.id === id ? { ...u, ...update } : u))
  }

  const { user } = useAuth()

  const processFile = useCallback(async (file: File) => {
    if (file.size > maxSizeBytes) {
      const id = generateId()
      setUploads(prev => [...prev, { id, file, stage: 'error', progress: 0, error: `File exceeds ${formatBytes(maxSizeBytes)} limit` }])
      return
    }

    if (!user) {
      const id = generateId()
      setUploads(prev => [...prev, { id, file, stage: 'error', progress: 0, error: 'You must be signed in to upload.' }])
      return
    }

    const id = generateId()
    setUploads(prev => [...prev, { id, file, stage: 'selected', progress: 0 }])
    await new Promise(r => setTimeout(r, 300))

    try {
      const result = await uploadFile(file, user.id, (pct, _stage) => {
        // Map progress percentage to the correct visual stage
        const vizStage: UploadStage =
          pct < 55 ? 'encrypting' :
          pct < 95 ? 'uploading' : 'uploading'
        updateUpload(id, { stage: vizStage, progress: pct })
      })

      updateUpload(id, {
        stage: 'complete',
        progress: 100,
        encryptionKey: result.encryptionKey,
        storagePath: result.storagePath,
      })

      onUploadComplete?.(result.fileId, result.encryptionKey, file.name)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Upload failed. Please try again.'
      updateUpload(id, { stage: 'error', error: msg })
    }
  }, [maxSizeBytes, onUploadComplete, user])

  const handleFiles = (files: FileList | null) => {
    if (!files) return
    Array.from(files).forEach(processFile)
  }

  const onDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    handleFiles(e.dataTransfer.files)
  }, [processFile])

  const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setDragging(true) }
  const onDragLeave = () => setDragging(false)

  const removeUpload = (id: string) => setUploads(prev => prev.filter(u => u.id !== id))

  return (
    <div className="space-y-4">
      {/* Drop zone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click() }}
        onDrop={onDrop}
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        className={cn(
          'relative flex flex-col items-center justify-center',
          'border rounded-lg cursor-pointer',
          'transition-all duration-300 select-none',
          'min-h-[180px] px-8 py-10',
          dragging
            ? 'border-[rgba(209,208,208,0.35)] bg-[rgba(209,208,208,0.04)]'
            : 'border-[rgba(209,208,208,0.1)] bg-[#0a0a0a] hover:border-[rgba(209,208,208,0.2)] hover:bg-[#0d0d0d]'
        )}
        aria-label="Upload file — click or drag and drop"
      >
        <input
          ref={inputRef}
          type="file"
          multiple
          className="sr-only"
          onChange={e => handleFiles(e.target.files)}
          aria-hidden="true"
        />

        <div className="flex flex-col items-center gap-4 text-center pointer-events-none">
          <div className={cn(
            'w-12 h-12 rounded border flex items-center justify-center transition-colors duration-300',
            dragging
              ? 'border-[rgba(209,208,208,0.4)] text-[#D1D0D0]'
              : 'border-[rgba(209,208,208,0.12)] text-[rgba(209,208,208,0.4)]'
          )}>
            {dragging ? <Lock size={20} /> : <Upload size={20} />}
          </div>
          <div>
            <p className="text-sm text-[rgba(209,208,208,0.7)] font-medium">
              {dragging ? 'Release to secure' : 'Drop files here or click to select'}
            </p>
            <p className="mt-1.5 text-xs text-[rgba(209,208,208,0.3)]">
              Encrypted locally before upload · Max {formatBytes(maxSizeBytes)}
            </p>
          </div>
        </div>

        {/* Corner decoration lines */}
        <div className="absolute top-3 left-3 w-4 h-4 border-t border-l border-[rgba(209,208,208,0.15)] pointer-events-none" />
        <div className="absolute top-3 right-3 w-4 h-4 border-t border-r border-[rgba(209,208,208,0.15)] pointer-events-none" />
        <div className="absolute bottom-3 left-3 w-4 h-4 border-b border-l border-[rgba(209,208,208,0.15)] pointer-events-none" />
        <div className="absolute bottom-3 right-3 w-4 h-4 border-b border-r border-[rgba(209,208,208,0.15)] pointer-events-none" />
      </div>

      {/* Upload items */}
      {uploads.map(upload => (
        <UploadItem key={upload.id} upload={upload} onRemove={removeUpload} />
      ))}
    </div>
  )
}

// ── Individual Upload Item ───────────────────────────────────────────────────
const UploadItem: React.FC<{ upload: UploadedFile; onRemove: (id: string) => void }> = ({ upload, onRemove }) => {
  const { file, stage, progress, error } = upload
  const isComplete = stage === 'complete'
  const isError = stage === 'error'
  // isProcessing used for future UI state indications
  // const isProcessing = !['complete', 'error', 'idle'].includes(stage)

  const progressPct = Math.round(progress)
  const stageIdx = STAGE_STEPS.indexOf(stage)

  return (
    <div className="border border-[rgba(209,208,208,0.08)] rounded-md bg-[#0c0c0c] overflow-hidden">
      <div className="px-4 py-3 flex items-center gap-3">
        {/* File icon */}
        <div className={cn(
          'w-8 h-8 rounded shrink-0 flex items-center justify-center border',
          isComplete ? 'border-[rgba(109,191,140,0.3)] bg-[rgba(109,191,140,0.08)] text-[#6dbf8c]' :
          isError ? 'border-[rgba(232,123,123,0.3)] bg-[rgba(232,123,123,0.08)] text-[#e87b7b]' :
          'border-[rgba(209,208,208,0.1)] bg-[rgba(209,208,208,0.04)] text-[rgba(209,208,208,0.5)]'
        )}>
          {isComplete ? <CheckCircle size={14} /> : isError ? <AlertCircle size={14} /> : <FileText size={14} />}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-2 mb-1">
            <p className="text-sm text-[#D1D0D0] truncate">{file.name}</p>
            <span className={cn(
              'text-[10px] font-medium tracking-wide shrink-0',
              isComplete ? 'text-[#6dbf8c]' : isError ? 'text-[#e87b7b]' : 'text-[rgba(209,208,208,0.5)]'
            )}>
              {isError ? 'Error' : stageLabels[stage]}
            </span>
          </div>

          {isError ? (
            <p className="text-xs text-[#e87b7b]">{error}</p>
          ) : isComplete ? (
            <div className="flex items-center gap-2">
              <Shield size={11} className="text-[#6dbf8c]" />
              <span className="text-xs text-[rgba(109,191,140,0.7)]">AES-256-GCM encrypted · {formatBytes(file.size)}</span>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <div className="flex-1 h-0.5 bg-[rgba(209,208,208,0.08)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[#D1D0D0] rounded-full transition-all duration-500 ease-out"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              <span className="text-[10px] text-[rgba(209,208,208,0.4)] font-mono shrink-0">{progressPct}%</span>
            </div>
          )}
        </div>

        {/* Close */}
        {(isComplete || isError) && (
          <button
            onClick={() => onRemove(upload.id)}
            className="p-1 text-[rgba(209,208,208,0.3)] hover:text-[rgba(209,208,208,0.7)] transition-colors shrink-0"
            aria-label="Remove"
          >
            <X size={13} />
          </button>
        )}
      </div>

      {/* Stage track */}
      {!isError && (
        <div className="px-4 pb-3 flex gap-1.5">
          {STAGE_STEPS.map((s, i) => (
            <div
              key={s}
              className={cn(
                'flex-1 h-0.5 rounded-full transition-all duration-500',
                i < stageIdx || isComplete ? 'bg-[rgba(209,208,208,0.35)]' :
                i === stageIdx ? 'shimmer bg-[rgba(209,208,208,0.15)]' :
                'bg-[rgba(209,208,208,0.07)]'
              )}
            />
          ))}
        </div>
      )}
    </div>
  )
}
