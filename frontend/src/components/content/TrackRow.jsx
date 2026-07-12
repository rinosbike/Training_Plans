import { useRef, useState } from 'react'
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

  function submitCaption() {
    const text = captionText.trim()
    if (text) onAddCaption(text)
    setCaptionText('')
    setAddingCaption(false)
  }

  return (
    <div className="flex border-b border-gray-800">
      <div className="w-28 shrink-0 flex flex-col justify-center gap-0.5 px-2 py-1 bg-gray-900 border-r border-gray-800">
        <div className="flex items-center justify-between gap-1">
          <span className="text-[11px] text-gray-300 truncate">{track.name}</span>
          <button onClick={() => onDelete(track.id)} className="text-gray-600 hover:text-red-400 text-[10px] shrink-0" title="Delete track">✕</button>
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
              accept={KIND_ACCEPT[track.kind]}
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) onUpload(f); e.target.value = '' }}
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

      <div className="relative flex-1 h-16 bg-gray-950">
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
