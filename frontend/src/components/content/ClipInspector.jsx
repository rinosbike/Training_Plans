import { useState, useEffect, useRef } from 'react'
import { useMutation } from '@tanstack/react-query'
import api from '../../services/api'
import toast from 'react-hot-toast'
import VideoPanel from './clip-panels/VideoPanel'
import ImagePanel from './clip-panels/ImagePanel'
import AudioPanel from './clip-panels/AudioPanel'
import TextPanel from './clip-panels/TextPanel'

const PANELS = { video: VideoPanel, image: ImagePanel, audio: AudioPanel, text: TextPanel }

export default function ClipInspector({ storyId, clip, track, playheadSec, onUpdate, onDelete, onTranscribed, onDuplicated, onSplit }) {
  const [startSec, setStartSec] = useState(clip.timeline_start_sec)
  const [endSec, setEndSec] = useState(clip.timeline_end_sec)
  const containerRef = useRef(null)

  useEffect(() => {
    setStartSec(clip.timeline_start_sec)
    setEndSec(clip.timeline_end_sec)
  }, [clip.id, clip.timeline_start_sec, clip.timeline_end_sec])

  // clicking a clip (especially a caption, which is easy to miss as "editable")
  // should bring this panel into view rather than leave it below the fold
  useEffect(() => {
    containerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }, [clip.id])

  const duplicateClip = useMutation({
    mutationFn: () => api.post(`/api/content/stories/${storyId}/tracks/${track.id}/clips/${clip.id}/duplicate`),
    onSuccess: () => { toast.success('Clip duplicated'); onDuplicated?.() },
    onError: (e) => toast.error(e.response?.data?.error || 'Duplicate failed'),
  })

  const splitClip = useMutation({
    mutationFn: () => api.post(`/api/content/stories/${storyId}/tracks/${track.id}/clips/${clip.id}/split`, { at_sec: playheadSec }),
    onSuccess: () => { toast.success('Clip split'); onSplit?.() },
    onError: (e) => toast.error(e.response?.data?.error || 'Split failed'),
  })

  const canSplit = playheadSec > clip.timeline_start_sec && playheadSec < clip.timeline_end_sec
  const duration = (clip.timeline_end_sec - clip.timeline_start_sec).toFixed(2)
  const Panel = PANELS[clip.source_type]

  function commitStart() {
    const v = Number(startSec)
    if (isNaN(v) || v === clip.timeline_start_sec || v >= clip.timeline_end_sec) {
      setStartSec(clip.timeline_start_sec)
      return
    }
    const delta = v - clip.timeline_start_sec
    const updates = { timeline_start_sec: v }
    if (clip.source_type !== 'text') {
      updates.trim_start_sec = Math.max(0, (clip.trim_start_sec || 0) + delta)
    }
    onUpdate(updates)
  }

  function commitEnd() {
    const v = Number(endSec)
    if (isNaN(v) || v === clip.timeline_end_sec || v <= clip.timeline_start_sec) {
      setEndSec(clip.timeline_end_sec)
      return
    }
    const delta = v - clip.timeline_end_sec
    const updates = { timeline_end_sec: v }
    if (clip.source_type !== 'text' && clip.trim_end_sec != null) {
      updates.trim_end_sec = clip.trim_end_sec + delta
    }
    onUpdate(updates)
  }

  return (
    <div ref={containerRef} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {track.name} · {clip.source_type}
        </span>
        <div className="flex items-center gap-3">
          <button
            onClick={() => splitClip.mutate()}
            disabled={!canSplit || splitClip.isPending}
            className="text-sm text-gray-400 hover:text-gray-700 disabled:opacity-30 disabled:hover:text-gray-400"
            title="Split at playhead"
          >✂️</button>
          <button
            onClick={() => duplicateClip.mutate()}
            disabled={duplicateClip.isPending}
            className="text-sm text-gray-400 hover:text-gray-700"
            title="Duplicate clip"
          >⧉</button>
          <button onClick={onDelete} className="text-gray-300 hover:text-red-500 text-xs" title="Delete clip">🗑</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
        <div className="flex items-center gap-1">
          Start:
          <input
            type="number" step="0.1" value={startSec}
            onChange={e => setStartSec(e.target.value)}
            onBlur={commitStart}
            className="w-16 font-mono text-gray-800 border border-gray-200 rounded px-1 py-0.5"
          />s
        </div>
        <div className="flex items-center gap-1">
          End:
          <input
            type="number" step="0.1" value={endSec}
            onChange={e => setEndSec(e.target.value)}
            onBlur={commitEnd}
            className="w-16 font-mono text-gray-800 border border-gray-200 rounded px-1 py-0.5"
          />s
        </div>
        <div>Duration: <span className="font-mono text-gray-800">{duration}s</span></div>
        {clip.source_duration_sec != null && (
          <div>Source: <span className="font-mono text-gray-800">{clip.source_duration_sec.toFixed(2)}s</span></div>
        )}
      </div>

      {Panel && <Panel storyId={storyId} clip={clip} onUpdate={onUpdate} onTranscribed={onTranscribed} />}
    </div>
  )
}
