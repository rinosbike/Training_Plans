import { useCallback, useRef } from 'react'

const MIN_DURATION_SEC = 0.2
const SNAP_PIXEL_THRESHOLD = 8

/**
 * Pointer-event drag/trim math for one timeline clip.
 * onChange(clipId, partialUpdates) fires on every pointermove (local/optimistic state).
 * onCommit(clipId) fires once on pointerup — callers PUT the accumulated changes then.
 */
export function useTimelineDrag({ clip, pixelsPerSecond, snapPoints = [], onChange, onCommit }) {
  const stateRef = useRef(null)

  const snap = useCallback((sec) => {
    const thresholdSec = SNAP_PIXEL_THRESHOLD / pixelsPerSecond
    let nearest = sec
    let nearestDist = thresholdSec
    for (const p of snapPoints) {
      const dist = Math.abs(sec - p)
      if (dist < nearestDist) { nearestDist = dist; nearest = p }
    }
    return nearest
  }, [pixelsPerSecond, snapPoints])

  const begin = useCallback((mode) => (e) => {
    e.preventDefault()
    e.stopPropagation()

    stateRef.current = {
      mode,
      startX: e.clientX,
      base: {
        timeline_start_sec: clip.timeline_start_sec,
        timeline_end_sec: clip.timeline_end_sec,
        trim_start_sec: clip.trim_start_sec || 0,
        trim_end_sec: clip.trim_end_sec,
      },
    }

    function handleMove(ev) {
      const s = stateRef.current
      if (!s) return
      const deltaSec = (ev.clientX - s.startX) / pixelsPerSecond
      const duration = s.base.timeline_end_sec - s.base.timeline_start_sec
      const maxTrim = clip.source_duration_sec != null ? clip.source_duration_sec : Infinity
      let updates = {}

      if (s.mode === 'move') {
        const newStart = Math.max(0, snap(s.base.timeline_start_sec + deltaSec))
        updates = { timeline_start_sec: newStart, timeline_end_sec: newStart + duration }
      } else if (s.mode === 'trim-left') {
        let newStart = snap(s.base.timeline_start_sec + deltaSec)
        newStart = Math.max(0, Math.min(newStart, s.base.timeline_end_sec - MIN_DURATION_SEC))
        const clipDelta = newStart - s.base.timeline_start_sec
        const newTrimStart = Math.max(0, Math.min(s.base.trim_start_sec + clipDelta, maxTrim))
        updates = { timeline_start_sec: newStart, trim_start_sec: newTrimStart }
      } else if (s.mode === 'trim-right') {
        let newEnd = snap(s.base.timeline_end_sec + deltaSec)
        newEnd = Math.max(newEnd, s.base.timeline_start_sec + MIN_DURATION_SEC)
        const clipDelta = newEnd - s.base.timeline_end_sec
        let newTrimEnd = s.base.trim_end_sec != null ? s.base.trim_end_sec + clipDelta : null
        if (newTrimEnd != null) newTrimEnd = Math.max(s.base.trim_start_sec + 0.1, Math.min(newTrimEnd, maxTrim))
        updates = { timeline_end_sec: newEnd, trim_end_sec: newTrimEnd }
      }

      onChange(clip.id, updates)
    }

    function handleUp() {
      window.removeEventListener('pointermove', handleMove)
      window.removeEventListener('pointerup', handleUp)
      stateRef.current = null
      onCommit(clip.id)
    }

    window.addEventListener('pointermove', handleMove)
    window.addEventListener('pointerup', handleUp)
  }, [clip, pixelsPerSecond, snap, onChange, onCommit])

  return {
    onMoveStart: begin('move'),
    onTrimLeftStart: begin('trim-left'),
    onTrimRightStart: begin('trim-right'),
  }
}
