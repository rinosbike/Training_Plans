import { useRef, useEffect, useCallback } from 'react'

const MAX_POOL_SIZE = 6
const DRIFT_THRESHOLD_SEC = 0.08

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = reject
    img.src = url
  })
}

/** Scale+crop to FILL the destination — mirrors ffmpeg's
 *  scale=...:force_original_aspect_ratio=increase,crop=... used at export time. */
function drawCover(ctx, source, srcW, srcH, dstW, dstH) {
  if (!srcW || !srcH) return
  const scale = Math.max(dstW / srcW, dstH / srcH)
  const drawW = srcW * scale
  const drawH = srcH * scale
  ctx.drawImage(source, (dstW - drawW) / 2, (dstH - drawH) / 2, drawW, drawH)
}

function wrapLines(ctx, text, maxWidth) {
  const words = text.split(' ')
  const lines = []
  let current = ''
  for (const w of words) {
    const test = current ? `${current} ${w}` : w
    if (current && ctx.measureText(test).width > maxWidth) {
      lines.push(current)
      current = w
    } else {
      current = test
    }
  }
  if (current) lines.push(current)
  return lines
}

function drawCaption(ctx, clip, canvasW, canvasH) {
  const style = clip.style_json || {}
  const fontSize = style.fontSize || Math.round(canvasH * 0.045)
  const color = style.color || '#ffffff'
  const yFrac = style.y != null ? style.y : 0.85

  ctx.save()
  ctx.font = `900 ${fontSize}px 'Lato Black', Arial, sans-serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.shadowColor = 'rgba(0,0,0,0.85)'
  ctx.shadowBlur = 6

  const lineHeight = fontSize * 1.2
  const lines = wrapLines(ctx, clip.text_content, canvasW * 0.85)
  const totalHeight = lines.length * lineHeight
  let y = yFrac * canvasH - totalHeight / 2 + lineHeight / 2

  ctx.fillStyle = color
  for (const line of lines) {
    ctx.fillText(line, canvasW / 2, y)
    y += lineHeight
  }
  ctx.restore()
}

/**
 * Composites the active clip on each track for the current playhead onto a
 * <canvas>, using a small pool of hidden <video>/<audio> elements reused
 * across clips (capped) rather than one element per clip.
 */
export function useCompositor({ canvasRef, tracks, clips, canvasW, canvasH, playheadSec, playing }) {
  const videoPoolRef = useRef(new Map())
  const audioPoolRef = useRef(new Map())
  const imageCacheRef = useRef(new Map())
  const drawFrameRef = useRef(() => {})

  const getVideoEl = useCallback((clipId, url) => {
    const pool = videoPoolRef.current
    let el = pool.get(clipId)
    if (el) { pool.delete(clipId); pool.set(clipId, el); return el }

    if (pool.size >= MAX_POOL_SIZE) {
      const oldestId = pool.keys().next().value
      const oldEl = pool.get(oldestId)
      oldEl.pause()
      oldEl.removeAttribute('src')
      pool.delete(oldestId)
    }
    el = document.createElement('video')
    el.crossOrigin = 'anonymous'
    el.playsInline = true
    el.preload = 'auto'
    el.addEventListener('loadeddata', () => drawFrameRef.current(), { once: true })
    el.src = url
    pool.set(clipId, el)
    return el
  }, [])

  const getAudioEl = useCallback((clipId, url) => {
    const pool = audioPoolRef.current
    let el = pool.get(clipId)
    if (el) { pool.delete(clipId); pool.set(clipId, el); return el }

    if (pool.size >= MAX_POOL_SIZE) {
      const oldestId = pool.keys().next().value
      const oldEl = pool.get(oldestId)
      oldEl.pause()
      oldEl.removeAttribute('src')
      pool.delete(oldestId)
    }
    el = document.createElement('audio')
    el.crossOrigin = 'anonymous'
    el.preload = 'auto'
    pool.set(clipId, el)
    el.src = url
    return el
  }, [])

  const getImage = useCallback((url) => {
    const cache = imageCacheRef.current
    let entry = cache.get(url)
    if (!entry) {
      entry = { img: null }
      entry.promise = loadImage(url).then(img => { entry.img = img; drawFrameRef.current() }).catch(() => {})
      cache.set(url, entry)
    }
    return entry.img
  }, [])

  const drawFrame = useCallback(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvasW, canvasH)

    const activeIds = new Set()

    const visualTracks = tracks
      .filter(t => t.kind === 'video' || t.kind === 'image')
      .sort((a, b) => a.z_index - b.z_index)

    for (const track of visualTracks) {
      const active = clips.find(c => c.track_id === track.id &&
        playheadSec >= c.timeline_start_sec && playheadSec < c.timeline_end_sec)
      if (!active) continue

      if (active.source_type === 'video' && active.source_url) {
        activeIds.add(active.id)
        const el = getVideoEl(active.id, active.source_url)
        const expected = (active.trim_start_sec || 0) + (playheadSec - active.timeline_start_sec)
        if (el.readyState >= 1 && Math.abs(el.currentTime - expected) > DRIFT_THRESHOLD_SEC) {
          try { el.currentTime = expected } catch { /* not seekable yet */ }
        }
        el.muted = track.muted || active.volume === 0
        el.volume = active.volume ?? 1
        if (playing) el.play?.().catch(() => {})
        else el.pause()

        if (el.readyState >= 2) drawCover(ctx, el, el.videoWidth, el.videoHeight, canvasW, canvasH)
      } else if (active.source_type === 'image' && active.source_url) {
        const img = getImage(active.source_url)
        if (img) drawCover(ctx, img, img.naturalWidth, img.naturalHeight, canvasW, canvasH)
      }
    }

    const audioTracks = tracks.filter(t => t.kind === 'audio')
    for (const track of audioTracks) {
      const active = clips.find(c => c.track_id === track.id &&
        playheadSec >= c.timeline_start_sec && playheadSec < c.timeline_end_sec)
      if (!active || !active.source_url) continue
      activeIds.add(active.id)
      const el = getAudioEl(active.id, active.source_url)
      const expected = (active.trim_start_sec || 0) + (playheadSec - active.timeline_start_sec)
      if (el.readyState >= 1 && Math.abs(el.currentTime - expected) > DRIFT_THRESHOLD_SEC) {
        try { el.currentTime = expected } catch { /* not seekable yet */ }
      }
      el.muted = track.muted || active.volume === 0
      el.volume = active.volume ?? 1
      if (playing) el.play?.().catch(() => {})
      else el.pause()
    }

    for (const [clipId, el] of videoPoolRef.current) {
      if (!activeIds.has(clipId)) el.pause()
    }
    for (const [clipId, el] of audioPoolRef.current) {
      if (!activeIds.has(clipId)) el.pause()
    }

    const captionTracks = tracks.filter(t => t.kind === 'caption').sort((a, b) => a.z_index - b.z_index)
    for (const track of captionTracks) {
      const active = clips.find(c => c.track_id === track.id &&
        playheadSec >= c.timeline_start_sec && playheadSec < c.timeline_end_sec)
      if (!active || !active.text_content) continue
      drawCaption(ctx, active, canvasW, canvasH)
    }
  }, [canvasRef, tracks, clips, canvasW, canvasH, playheadSec, playing, getVideoEl, getAudioEl, getImage])

  useEffect(() => { drawFrameRef.current = drawFrame }, [drawFrame])
  // playheadSec changes every rAF tick while playing (driven by usePlaybackClock),
  // which recreates drawFrame and re-runs this effect — no separate draw loop needed here.
  useEffect(() => { drawFrame() }, [drawFrame])

  useEffect(() => {
    return () => {
      for (const el of videoPoolRef.current.values()) { el.pause(); el.removeAttribute('src') }
      for (const el of audioPoolRef.current.values()) { el.pause(); el.removeAttribute('src') }
      videoPoolRef.current.clear()
      audioPoolRef.current.clear()
    }
  }, [])
}
