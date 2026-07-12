import { useState, useEffect } from 'react'

const FIELDS = [
  { key: 'brightness', label: 'Brightness', min: -0.5, max: 0.5, step: 0.05, default: 0 },
  { key: 'contrast', label: 'Contrast', min: 0, max: 2, step: 0.05, default: 1 },
  { key: 'saturation', label: 'Saturation', min: 0, max: 2, step: 0.05, default: 1 },
]

export default function FilterSliders({ styleJson, onUpdate }) {
  const [values, setValues] = useState({
    brightness: styleJson.brightness ?? 0,
    contrast: styleJson.contrast ?? 1,
    saturation: styleJson.saturation ?? 1,
  })

  useEffect(() => {
    setValues({
      brightness: styleJson.brightness ?? 0,
      contrast: styleJson.contrast ?? 1,
      saturation: styleJson.saturation ?? 1,
    })
  }, [styleJson])

  function commit(key, value) {
    onUpdate({ style_json: { ...styleJson, [key]: value } })
  }

  return (
    <div className="space-y-2">
      <label className="block text-xs font-medium text-gray-500">Filters</label>
      {FIELDS.map(f => (
        <div key={f.key} className="flex items-center gap-2">
          <span className="text-[11px] text-gray-400 w-16 shrink-0">{f.label}</span>
          <input
            type="range" min={f.min} max={f.max} step={f.step}
            value={values[f.key]}
            onChange={e => setValues(v => ({ ...v, [f.key]: Number(e.target.value) }))}
            onMouseUp={() => commit(f.key, values[f.key])}
            onTouchEnd={() => commit(f.key, values[f.key])}
            className="flex-1 accent-primary-600"
          />
          {values[f.key] !== f.default && (
            <button
              onClick={() => { setValues(v => ({ ...v, [f.key]: f.default })); commit(f.key, f.default) }}
              className="text-[10px] text-gray-400 hover:text-gray-600"
              title="Reset"
            >
              ↺
            </button>
          )}
        </div>
      ))}
    </div>
  )
}
