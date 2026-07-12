function pickStepSec(pixelsPerSecond) {
  if (pixelsPerSecond >= 80) return 1
  if (pixelsPerSecond >= 30) return 5
  return 10
}

export default function TimelineRuler({ durationSec, pixelsPerSecond, playheadSec, onSeek }) {
  const width = Math.max(durationSec, 10) * pixelsPerSecond
  const step = pickStepSec(pixelsPerSecond)
  const marks = []
  for (let t = 0; t <= Math.ceil(Math.max(durationSec, 10)); t += step) marks.push(t)

  function handleClick(e) {
    const rect = e.currentTarget.getBoundingClientRect()
    const sec = (e.clientX - rect.left) / pixelsPerSecond
    onSeek(Math.max(0, sec))
  }

  return (
    <div
      className="relative h-6 bg-gray-900 border-b border-gray-800 cursor-pointer select-none shrink-0"
      style={{ width }}
      onClick={handleClick}
    >
      {marks.map(t => (
        <div
          key={t}
          className="absolute top-0 bottom-0 border-l border-gray-700 text-[9px] text-gray-500 pl-1 leading-6"
          style={{ left: t * pixelsPerSecond }}
        >
          {t}s
        </div>
      ))}
      <div
        className="absolute top-0 bottom-0 w-px bg-red-500 pointer-events-none"
        style={{ left: playheadSec * pixelsPerSecond }}
      />
    </div>
  )
}
