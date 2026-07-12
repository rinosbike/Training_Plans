import { useRef, useCallback } from 'react'
import { useCompositor } from '../../hooks/useCompositor'

const MAX_PREVIEW_DIM = 480

export default function CanvasPreview({
  tracks, clips, presetW, presetH, playheadSec, playing,
  selectedClipId, onChangeClip, onCommitClip,
}) {
  const canvasRef = useRef(null)
  const scale = MAX_PREVIEW_DIM / Math.max(presetW, presetH)
  const canvasW = Math.round(presetW * scale)
  const canvasH = Math.round(presetH * scale)

  useCompositor({ canvasRef, tracks, clips, canvasW, canvasH, playheadSec, playing })

  const selectedClip = clips.find(c => c.id === selectedClipId)
  const isDraggableText = selectedClip?.source_type === 'text' && onChangeClip && onCommitClip

  const handlePointerDown = useCallback((e) => {
    if (!isDraggableText) return
    const canvas = canvasRef.current
    if (!canvas) return
    e.preventDefault()

    const baseStyle = selectedClip.style_json || {}

    function toFraction(ev) {
      const rect = canvas.getBoundingClientRect()
      return {
        x: Math.min(1, Math.max(0, (ev.clientX - rect.left) / rect.width)),
        y: Math.min(1, Math.max(0, (ev.clientY - rect.top) / rect.height)),
      }
    }

    function handleMove(ev) {
      const { x, y } = toFraction(ev)
      onChangeClip(selectedClip.id, { style_json: { ...baseStyle, x, y } })
    }
    function handleUp() {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      onCommitClip(selectedClip.id)
    }

    handleMove(e)
    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }, [isDraggableText, selectedClip, onChangeClip, onCommitClip])

  return (
    <div className="flex items-center justify-center bg-black rounded-xl overflow-hidden p-3">
      <canvas
        ref={canvasRef}
        width={canvasW}
        height={canvasH}
        onPointerDown={handlePointerDown}
        className={`rounded-lg shadow-xl ${isDraggableText ? 'cursor-move' : ''}`}
        style={{ maxWidth: '100%', height: 'auto' }}
      />
    </div>
  )
}
