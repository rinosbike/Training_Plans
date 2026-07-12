import { useRef } from 'react'
import { useCompositor } from '../../hooks/useCompositor'

const MAX_PREVIEW_DIM = 480

export default function CanvasPreview({ tracks, clips, presetW, presetH, playheadSec, playing }) {
  const canvasRef = useRef(null)
  const scale = MAX_PREVIEW_DIM / Math.max(presetW, presetH)
  const canvasW = Math.round(presetW * scale)
  const canvasH = Math.round(presetH * scale)

  useCompositor({ canvasRef, tracks, clips, canvasW, canvasH, playheadSec, playing })

  return (
    <div className="flex items-center justify-center bg-black rounded-xl overflow-hidden p-3">
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        className="rounded-lg shadow-xl"
        style={{ maxWidth: '100%', height: 'auto' }}
      />
    </div>
  )
}
