import FilterSliders from './FilterSliders'
import TransitionControl from './TransitionControl'

const KEN_BURNS_PRESETS = {
  none: null,
  zoom_in: { from: { scale: 1.0, x: 0.5, y: 0.5 }, to: { scale: 1.15, x: 0.5, y: 0.5 } },
  zoom_out: { from: { scale: 1.15, x: 0.5, y: 0.5 }, to: { scale: 1.0, x: 0.5, y: 0.5 } },
  pan_lr: { from: { scale: 1.1, x: 0.3, y: 0.5 }, to: { scale: 1.1, x: 0.7, y: 0.5 } },
}

const PRESET_LABELS = {
  none: 'None',
  zoom_in: 'Zoom in',
  zoom_out: 'Zoom out',
  pan_lr: 'Pan left → right',
}

function currentPresetKey(kenBurns) {
  if (!kenBurns) return 'none'
  for (const [key, val] of Object.entries(KEN_BURNS_PRESETS)) {
    if (val && JSON.stringify(val) === JSON.stringify(kenBurns)) return key
  }
  return 'none'
}

export default function ImagePanel({ clip, onUpdate }) {
  const styleJson = clip.style_json || {}
  const activeKey = currentPresetKey(styleJson.ken_burns)

  function applyPreset(key) {
    const preset = KEN_BURNS_PRESETS[key]
    const nextStyle = { ...styleJson }
    if (preset) nextStyle.ken_burns = preset
    else delete nextStyle.ken_burns
    onUpdate({ style_json: nextStyle })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Ken Burns pan/zoom</label>
        <div className="flex flex-wrap gap-1.5">
          {Object.keys(KEN_BURNS_PRESETS).map(key => (
            <button
              key={key}
              onClick={() => applyPreset(key)}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                activeKey === key
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {PRESET_LABELS[key]}
            </button>
          ))}
        </div>
      </div>

      <FilterSliders styleJson={styleJson} onUpdate={onUpdate} />

      <TransitionControl clip={clip} onUpdate={onUpdate} />
    </div>
  )
}
