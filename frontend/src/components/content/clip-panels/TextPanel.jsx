import { useState, useEffect } from 'react'

const FONTS = [
  { key: 'Arial Black, sans-serif', label: 'Bold Sans' },
  { key: 'Impact, sans-serif', label: 'Impact' },
  { key: 'Georgia, serif', label: 'Georgia' },
  { key: 'Verdana, sans-serif', label: 'Verdana' },
  { key: '"Courier New", monospace', label: 'Typewriter' },
]

const COLORS = ['#ffffff', '#000000', '#fbbf24', '#f87171', '#4ade80', '#60a5fa']

const BACKGROUNDS = [
  { key: 'none', label: 'None' },
  { key: 'box', label: 'Box' },
  { key: 'solid', label: 'Solid' },
  { key: 'outline', label: 'Outline' },
]

const ANIMATIONS_IN = [
  { key: 'none', label: 'None' },
  { key: 'fade', label: 'Fade' },
  { key: 'slide_up', label: 'Slide up' },
]

const ANIMATIONS_OUT = [
  { key: 'none', label: 'None' },
  { key: 'fade', label: 'Fade' },
]

export default function TextPanel({ clip, onUpdate }) {
  const [text, setText] = useState(clip.text_content || '')
  const styleJson = clip.style_json || {}
  const animation = styleJson.animation || {}

  useEffect(() => { setText(clip.text_content || '') }, [clip.id, clip.text_content])

  function updateStyle(patch) {
    onUpdate({ style_json: { ...styleJson, ...patch } })
  }

  function updateAnimation(key, value) {
    onUpdate({ style_json: { ...styleJson, animation: { ...animation, [key]: value } } })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Caption text</label>
        <textarea
          className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
          rows={2}
          value={text}
          onChange={e => setText(e.target.value)}
          onBlur={() => text !== (clip.text_content || '') && onUpdate({ text_content: text })}
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Font</label>
        <select
          value={styleJson.fontFamily || FONTS[0].key}
          onChange={e => updateStyle({ fontFamily: e.target.value })}
          className="w-full text-sm border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
        >
          {FONTS.map(f => <option key={f.key} value={f.key}>{f.label}</option>)}
        </select>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">
          Size ({styleJson.fontSize || 78}px)
        </label>
        <input
          type="range" min={30} max={140} step={2}
          value={styleJson.fontSize || 78}
          onChange={e => updateStyle({ fontSize: Number(e.target.value) })}
          className="w-full accent-primary-600"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Color</label>
        <div className="flex gap-1.5">
          {COLORS.map(c => (
            <button
              key={c}
              onClick={() => updateStyle({ color: c })}
              className={`w-7 h-7 rounded-full border-2 transition-transform ${
                (styleJson.color || '#ffffff') === c ? 'border-primary-600 scale-110' : 'border-gray-200'
              }`}
              style={{ backgroundColor: c }}
              title={c}
            />
          ))}
        </div>
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Background</label>
        <div className="flex flex-wrap gap-1.5">
          {BACKGROUNDS.map(b => (
            <button
              key={b.key}
              onClick={() => updateStyle({ background: b.key })}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                (styleJson.background || 'none') === b.key
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Animate in</label>
          <select
            value={animation.in || 'none'}
            onChange={e => updateAnimation('in', e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
          >
            {ANIMATIONS_IN.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Animate out</label>
          <select
            value={animation.out || 'none'}
            onChange={e => updateAnimation('out', e.target.value)}
            className="w-full text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white"
          >
            {ANIMATIONS_OUT.map(a => <option key={a.key} value={a.key}>{a.label}</option>)}
          </select>
        </div>
      </div>

      <p className="text-[11px] text-gray-400">
        Drag the text directly on the preview above to reposition it.
      </p>
    </div>
  )
}
