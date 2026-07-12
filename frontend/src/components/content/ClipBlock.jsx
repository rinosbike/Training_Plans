import { useTimelineDrag } from '../../hooks/useTimelineDrag'

const COLOR_BY_SOURCE_TYPE = {
  video: 'bg-blue-500',
  image: 'bg-emerald-500',
  audio: 'bg-amber-500',
  text: 'bg-violet-500',
}

function clipLabel(clip) {
  if (clip.source_type === 'text') return clip.text_content || 'Caption'
  if (!clip.source_url) return clip.source_type
  try {
    return decodeURIComponent(clip.source_url.split('/').pop())
  } catch {
    return clip.source_type
  }
}

export default function ClipBlock({ clip, pixelsPerSecond, selected, onSelect, onChange, onCommit, snapPoints }) {
  const { onMoveStart, onTrimLeftStart, onTrimRightStart } = useTimelineDrag({
    clip, pixelsPerSecond, snapPoints, onChange, onCommit,
  })

  const left = clip.timeline_start_sec * pixelsPerSecond
  const width = Math.max((clip.timeline_end_sec - clip.timeline_start_sec) * pixelsPerSecond, 6)
  const color = COLOR_BY_SOURCE_TYPE[clip.source_type] || 'bg-gray-500'

  return (
    <div
      className={`absolute top-1.5 bottom-1.5 rounded-md ${color} ${selected ? 'ring-2 ring-white' : 'ring-1 ring-black/20'} cursor-grab active:cursor-grabbing select-none`}
      style={{ left, width }}
      onPointerDown={(e) => { onSelect(clip.id); onMoveStart(e) }}
      title={clipLabel(clip)}
    >
      {clip.source_type === 'image' && clip.source_url && (
        <img src={clip.source_url} alt="" className="absolute inset-0 w-full h-full object-cover rounded-md opacity-40 pointer-events-none" />
      )}
      <div className="relative px-1.5 py-0.5 text-[10px] text-white font-medium truncate pointer-events-none drop-shadow">
        {clipLabel(clip)}
      </div>

      <div
        className="absolute left-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40 rounded-l-md"
        onPointerDown={(e) => { e.stopPropagation(); onSelect(clip.id); onTrimLeftStart(e) }}
      />
      <div
        className="absolute right-0 top-0 bottom-0 w-2 cursor-ew-resize bg-white/0 hover:bg-white/40 rounded-r-md"
        onPointerDown={(e) => { e.stopPropagation(); onSelect(clip.id); onTrimRightStart(e) }}
      />
    </div>
  )
}
