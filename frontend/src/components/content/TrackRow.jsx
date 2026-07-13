import { useRef, useState } from 'react'
import toast from 'react-hot-toast'
import ClipBlock from './ClipBlock'

const KIND_ACCEPT = {
  video: 'video/mp4,video/quicktime,video/webm',
  image: 'image/jpeg,image/png,image/webp,image/gif',
  audio: 'audio/mpeg,audio/mp4,audio/wav,audio/webm,audio/ogg',
}

export default function TrackRow({
  track, clips, pixelsPerSecond, selectedClipId, onSelectClip,
  onChangeClip, onCommitClip, snapPoints, onDelete, onUpload, onAddCaption, uploading,
}) {
  const fileRef = useRef(null)
  const [addingCaption, setAddingCaption] = useState(false)
  const [captionText, setCaptionText] = useState('')
  const [isDragOver, setIsDragOver] = useState(false)

  function submitCaption() {
    const text = captionText.trim()
    if (text) onAddCaption(text)
    setCaptionText('')
    setAddingCaption(false)
  }

  // uploads happen ONE AT A TIME (awaited) — the server computes a new clip's
  // timeline position from the current max end-time across the whole story,
  // so firing several uploads in parallel would race and stack every new
  // clip at the same position
  async function handleFiles(fileList) {
    const accept = (KIND_ACCEPT[track.kind] || '').split(',')
    const files = Array.from(fileList).filter(f => accept.includes(f.type))
    for (const f of files) {
      try {
        await onUpload(f)
      } catch {
        // individual failures are already toasted by the upload mutation — keep going
      }
    }
  }

  function confirmDeleteTrack() {
    toast((t) => (
      <span className="flex flex-col gap-2">
        <span>
          Delete "{track.name}" and its {clips.length} clip{clips.length === 1 ? '' : 's'}? This can't be undone.
        </span>
        <span className="flex gap-3 justify-end">
          <button onClick={() => toast.dismiss(t.id)} className="text-xs text-gray-500 hover:text-gray-700">
            Cancel
          </button>
          <button
            onClick={() => { toast.dismiss(t.id); onDelete(track.id) }}
            className="text-xs font-semibold text-red-600 hover:text-red-700"
          >
            Delete
          </button>
        </span>
      </span>
    ), { duration: 10000 })
  }

  const canDrop = track.kind !== 'caption'

  return (
    <div className="flex border-b border-gray-800">
      <div className="w-28 shrink-0 flex flex-col justify-center gap-0.5 px-2 py-1 bg-gray-900 border-r border-gray-800">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] text-gray-300 truncate">{track.name}</span>
          <button onClick={confirmDeleteTrack} className="text-gray-600 hover:text-red-400 text-[10px] shrink-0" title="Delete track">✕</button>
        </div>
        <span className="text-[9px] text-gray-500 uppercase tracking-wide">{track.kind}</span>

        {track.kind === 'caption' ? (
          addingCaption ? (
            <input
              autoFocus
              value={captionText}
              onChange={e => setCaptionText(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && submitCaption()}
              onBlur={submitCaption}
              className="w-full text-[10px] bg-gray-800 text-white rounded px-1 py-0.5 outline-none mt-0.5"
              placeholder="Caption text…"
            />
          ) : (
            <button onClick={() => setAddingCaption(true)} className="text-[10px] text-primary-400 hover:text-primary-300 text-left mt-0.5">
              + caption
            </button>
          )
        ) : (
          <>
            <input
              ref={fileRef}
              type="file"
              multiple
              accept={KIND_ACCEPT[track.kind]}
              className="hidden"
              onChange={e => { const files = e.target.files; if (files?.length) handleFiles(files); e.target.value = '' }}
            />
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploading}
              className="text-[10px] text-primary-400 hover:text-primary-300 text-left mt-0.5 disabled:opacity-50"
            >
              {uploading ? 'uploading…' : '+ upload'}
            </button>
          </>
        )}
      </div>

      <div
        className={`relative flex-1 h-16 bg-gray-950 ${isDragOver ? 'outline outline-2 outline-primary-500 -outline-offset-2' : ''}`}
        onDragOver={e => { if (!canDrop) return; e.preventDefault(); setIsDragOver(true) }}
        onDragLeave={() => setIsDragOver(false)}
        onDrop={e => {
          if (!canDrop) return
          e.preventDefault()
          setIsDragOver(false)
          if (e.dataTransfer.files?.length) handleFiles(e.dataTransfer.files)
        }}
      >
        {clips.length === 0 && (
          track.kind === 'caption' ? (
            <button
              onClick={() => setAddingCaption(true)}
              className="absolute inset-0 flex items-center justify-center text-xs text-gray-600 hover:text-primary-400"
            >
              + Add caption
            </button>
          ) : (
            <button
              onClick={() => fileRef.current?.click()}
              className="absolute inset-0 flex items-center justify-center text-xs text-gray-600 hover:text-primary-400"
            >
              + Add {track.kind}
            </button>
          )
        )}
        {clips.map(clip => (
          <ClipBlock
            key={clip.id}
            clip={clip}
            pixelsPerSecond={pixelsPerSecond}
            selected={clip.id === selectedClipId}
            onSelect={onSelectClip}
            onChange={onChangeClip}
            onCommit={onCommitClip}
            snapPoints={snapPoints}
          />
        ))}
      </div>
    </div>
  )
}
