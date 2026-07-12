const DURATION_OPTIONS = [0.3, 0.5, 0.8, 1.2]

export default function TransitionControl({ clip, onUpdate }) {
  const styleJson = clip.style_json || {}
  const transition = styleJson.transition_in
  const enabled = !!transition

  function toggle() {
    const nextStyle = { ...styleJson }
    if (enabled) {
      delete nextStyle.transition_in
    } else {
      nextStyle.transition_in = { type: 'fade', duration_sec: 0.5 }
    }
    onUpdate({ style_json: nextStyle })
  }

  function setDuration(d) {
    onUpdate({ style_json: { ...styleJson, transition_in: { type: 'fade', duration_sec: d } } })
  }

  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1">Transition in</label>
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          onClick={toggle}
          className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
            enabled
              ? 'bg-primary-600 text-white border-primary-600'
              : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
          }`}
        >
          {enabled ? '✓ Fade' : 'Fade from previous clip'}
        </button>
        {enabled && DURATION_OPTIONS.map(d => (
          <button
            key={d}
            onClick={() => setDuration(d)}
            className={`text-xs px-2 py-1 rounded-lg border transition-colors ${
              transition.duration_sec === d
                ? 'bg-gray-800 text-white border-gray-800'
                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
            }`}
          >
            {d}s
          </button>
        ))}
      </div>
    </div>
  )
}
