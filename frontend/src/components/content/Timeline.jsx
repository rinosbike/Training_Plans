import { useState, useMemo } from 'react'
import TimelineRuler from './TimelineRuler'
import TrackRow from './TrackRow'

export default function Timeline({
  tracks, clips, selectedClipId, onSelectClip, onChangeClip, onCommitClip,
  onDeleteTrack, onUploadClip, onAddCaption, uploading, playheadSec, onSeek,
}) {
  const [pixelsPerSecond, setPixelsPerSecond] = useState(40)

  const clipsByTrack = useMemo(() => {
    const map = {}
    for (const c of clips) { (map[c.track_id] ||= []).push(c) }
    for (const list of Object.values(map)) list.sort((a, b) => a.timeline_start_sec - b.timeline_start_sec)
    return map
  }, [clips])

  const durationSec = useMemo(
    () => clips.reduce((m, c) => Math.max(m, c.timeline_end_sec), 10),
    [clips]
  )

  const snapPoints = useMemo(() => {
    const pts = new Set([0, playheadSec])
    for (const c of clips) { pts.add(c.timeline_start_sec); pts.add(c.timeline_end_sec) }
    return Array.from(pts)
  }, [clips, playheadSec])

  const sortedTracks = useMemo(() => [...tracks].sort((a, b) => a.position - b.position), [tracks])
  const trackAreaWidth = Math.max(durationSec, 10) * pixelsPerSecond

  return (
    <div className="bg-black rounded-xl overflow-hidden border border-gray-800">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-900 border-b border-gray-800">
        <span className="text-[10px] text-gray-400 font-mono">{durationSec.toFixed(1)}s</span>
        <div className="flex items-center gap-2">
          <button onClick={() => setPixelsPerSecond(p => Math.max(10, p - 10))} className="text-gray-400 hover:text-white text-sm px-1.5">−</button>
          <span className="text-[10px] text-gray-500">zoom</span>
          <button onClick={() => setPixelsPerSecond(p => Math.min(200, p + 10))} className="text-gray-400 hover:text-white text-sm px-1.5">+</button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <div style={{ minWidth: trackAreaWidth + 112 }}>
          <div className="flex">
            <div className="w-28 shrink-0 bg-gray-900 border-r border-gray-800 border-b border-gray-800" />
            <TimelineRuler durationSec={durationSec} pixelsPerSecond={pixelsPerSecond} playheadSec={playheadSec} onSeek={onSeek} />
          </div>

          {sortedTracks.length === 0 ? (
            <p className="text-xs text-gray-500 text-center py-8">No tracks yet — add one above.</p>
          ) : (
            sortedTracks.map(track => (
              <TrackRow
                key={track.id}
                track={track}
                clips={clipsByTrack[track.id] || []}
                pixelsPerSecond={pixelsPerSecond}
                selectedClipId={selectedClipId}
                onSelectClip={onSelectClip}
                onChangeClip={onChangeClip}
                onCommitClip={onCommitClip}
                snapPoints={snapPoints}
                onDelete={onDeleteTrack}
                onUpload={(file) => onUploadClip(track.id, file)}
                onAddCaption={(text) => onAddCaption(track.id, text)}
                uploading={uploading}
              />
            ))
          )}
        </div>
      </div>
    </div>
  )
}
