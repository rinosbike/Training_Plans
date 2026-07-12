import { useRef, useEffect, useCallback } from 'react'

const MAX_POOL_SIZE = 6
const DRIFT_THRESHOLD_SEC = 0.08
const ANIM_DURATION_SEC = 0.4
const DUCK_FACTOR = 0.35 // matches _DUCK_FACTOR in timeline_export_service.py

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
 *  scale=...:force_original_aspect_ratio=increase,crop=... used at export time.
 *  extraScale/focusX/focusY let Ken Burns zoom/pan beyond the plain cover fill. */
function drawCoverTransformed(ctx, source, srcW, srcH, dstW, dstH, extraScale = 1, focusX = 0.5, focusY = 0.5) {
  if (!srcW || !srcH) return
  const baseScale = Math.max(dstW / srcW, dstH / srcH)
  const scale = baseScale * extraScale
  const drawW = srcW * scale
  const drawH = srcH * scale
  const dx = dstW / 2 - drawW * focusX
  const dy = dstH / 2 - drawH * focusY
  ctx.drawImage(source, dx, dy, drawW, drawH)
}

function cssFilterFor(styleJson) {
  const brightness = styleJson.brightness ?? 0
  const contrast = styleJson.contrast ?? 1
  const saturation = styleJson.saturation ?? 1
  if (brightness === 0 && contrast === 1 && saturation === 1) return 'none'
  // our brightness is additive (ffmpeg eq convention, -0.5..0.5); CSS brightness() is
  // multiplicative — 1+brightness is a reasonable preview approximation of the same idea
  return `brightness(${1 + brightness}) contrast(${contrast}) saturate(${saturation})`
}

function kenBurnsTransform(clip, playheadSec) {
  const kb = clip.style_json?.ken_burns
  if (!kb) return { scale: 1, x: 0.5, y: 0.5 }
  const duration = clip.timeline_end_sec - clip.timeline_start_sec
  const progress = duration > 0
    ? Math.min(1, Math.max(0, (playheadSec - clip.timeline_start_sec) / duration))
    : 0
  return {
    scale: kb.from.scale + (kb.to.scale - kb.from.scale) * progress,
    x: kb.from.x + (kb.to.x - kb.from.x) * progress,
    y: kb.from.y + (kb.to.y - kb.from.y) * progress,
  }
}

/** Fade-to-transparent at same-track clip boundaries — mirrors
 *  _transition_filter() in timeline_export_service.py. Clips stay back-to-back
 *  (no timeline overlap), so this isn't a true cross-dissolve of two
 *  simultaneously-visible clips; each clip ramps its own alpha to 0 at its
 *  start (if it declares transition_in) and/or at its end (if the next
 *  same-track clip declares transition_in), revealing whatever's beneath. */
function transitionAlpha(track, allClips, active, playheadSec) {
  const style = active.style_json || {}
  const duration = active.timeline_end_sec - active.timeline_start_sec
  const t = playheadSec - active.timeline_start_sec
  const remaining = active.timeline_end_sec - playheadSec
  let alpha = 1

  const own = style.transition_in
  if (own) {
    const d = Math.min(own.duration_sec || 0, duration)
    if (d > 0 && t < d) alpha = Math.min(alpha, Math.max(0, t / d))
  }

  const trackClips = allClips
    .filter(c => c.track_id === track.id)
    .sort((a, b) => a.timeline_start_sec - b.timeline_start_sec)
  const idx = trackClips.findIndex(c => c.id === active.id)
  const next = idx >= 0 ? trackClips[idx + 1] : null
  const nextTransition = next?.style_json?.transition_in
  if (nextTransition) {
    const d = Math.min(nextTransition.duration_sec || 0, duration)
    if (d > 0 && remaining < d) alpha = Math.min(alpha, Math.max(0, remaining / d))
  }

  return alpha
}

function fadeMultiplier(clip) {
  return (t, remaining) => {
    const style = clip.style_json || {}
    const fadeIn = style.fade_in_sec || 0
    const fadeOut = style.fade_out_sec || 0
    let mult = 1
    if (fadeIn > 0 && t < fadeIn) mult = Math.min(mult, t / fadeIn)
    if (fadeOut > 0 && remaining < fadeOut) mult = Math.min(mult, remaining / fadeOut)
    return Math.max(0, mult)
  }
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

function captionAnimAlpha(clip, t, remaining) {
  const anim = clip.style_json?.animation || {}
  let alpha = 1
  if (anim.in === 'fade' && t < ANIM_DURATION_SEC) alpha = Math.min(alpha, t / ANIM_DURATION_SEC)
  if (anim.out === 'fade' && remaining < ANIM_DURATION_SEC) alpha = Math.min(alpha, remaining / ANIM_DURATION_SEC)
  return Math.max(0, alpha)
}

function captionSlideOffset(clip, t, canvasH) {
  const anim = clip.style_json?.animation || {}
  if (anim.in !== 'slide_up' || t >= ANIM_DURATION_SEC) return 0
  const progress = Math.max(0, t / ANIM_DURATION_SEC)
  return (1 - progress) * canvasH * 0.08
}

function drawCaption(ctx, clip, canvasW, canvasH, playheadSec) {
  const style = clip.style_json || {}
  const t = playheadSec - clip.timeline_start_sec
  const remaining = clip.timeline_end_sec - playheadSec
  const alpha = captionAnimAlpha(clip, t, remaining)
  if (alpha <= 0) return

  const fontSize = style.fontSize || Math.round(canvasH * 0.045)
  const color = style.color || '#ffffff'
  const fontFamily = style.fontFamily || "'Lato Black', Arial, sans-serif"
  const xFrac = style.x != null ? style.x : 0.5
  const yFrac = style.y != null ? style.y : 0.85
  const background = style.background || 'none'
  const slideOffset = captionSlideOffset(clip, t, canvasH)

  ctx.save()
  ctx.globalAlpha = alpha
  ctx.font = `900 ${fontSize}px ${fontFamily}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  const lineHeight = fontSize * 1.2
  const lines = wrapLines(ctx, clip.text_content, canvasW * 0.85)
  const totalHeight = lines.length * lineHeight
  const centerX = xFrac * canvasW
  let y = yFrac * canvasH - totalHeight / 2 + lineHeight / 2 + slideOffset

  if (background === 'box' || background === 'solid') {
    const maxLineWidth = Math.max(...lines.map(l => ctx.measureText(l).width))
    const padX = fontSize * 0.4
    const padY = fontSize * 0.25
    ctx.fillStyle = background === 'solid' ? 'rgba(0,0,0,1)' : 'rgba(0,0,0,0.55)'
    ctx.fillRect(centerX - maxLineWidth / 2 - padX, y - lineHeight / 2 - padY, maxLineWidth + padX * 2, totalHeight + padY * 2)
  }

  if (background === 'outline') {
    ctx.lineWidth = fontSize * 0.08
    ctx.strokeStyle = '#000000'
    ctx.lineJoin = 'round'
  } else {
    ctx.shadowColor = 'rgba(0,0,0,0.85)'
    ctx.shadowBlur = 6
  }

  ctx.fillStyle = color
  for (const line of lines) {
    if (background === 'outline') ctx.strokeText(line, centerX, y)
    ctx.fillText(line, centerX, y)
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
    ctx.filter = 'none'
    ctx.globalAlpha = 1
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, canvasW, canvasH)

    const activeIds = new Set()

    // duck other audio while any caption is showing — matches _duck_filter()
    // in timeline_export_service.py (same trigger, same factor)
    const anyCaptionActive = clips.some(c => {
      const track = tracks.find(t => t.id === c.track_id)
      return track?.kind === 'caption' && c.text_content &&
        playheadSec >= c.timeline_start_sec && playheadSec < c.timeline_end_sec
    })
    const duck = anyCaptionActive ? DUCK_FACTOR : 1

    const visualTracks = tracks
      .filter(t => t.kind === 'video' || t.kind === 'image')
      .sort((a, b) => a.z_index - b.z_index)

    for (const track of visualTracks) {
      const active = clips.find(c => c.track_id === track.id &&
        playheadSec >= c.timeline_start_sec && playheadSec < c.timeline_end_sec)
      if (!active) continue

      const styleJson = active.style_json || {}
      ctx.filter = cssFilterFor(styleJson)
      ctx.globalAlpha = transitionAlpha(track, clips, active, playheadSec)

      if (active.source_type === 'video' && active.source_url) {
        activeIds.add(active.id)
        const speed = active.speed || 1
        const el = getVideoEl(active.id, active.source_url)
        const expected = (active.trim_start_sec || 0) + (playheadSec - active.timeline_start_sec) * speed
        if (el.readyState >= 1 && Math.abs(el.currentTime - expected) > DRIFT_THRESHOLD_SEC) {
          try { el.currentTime = expected } catch { /* not seekable yet */ }
        }
        try { el.playbackRate = speed } catch { /* ignore unsupported rate */ }
        const fade = fadeMultiplier(active)(playheadSec - active.timeline_start_sec, active.timeline_end_sec - playheadSec)
        el.muted = track.muted || active.volume === 0
        el.volume = (active.volume ?? 1) * fade * duck
        if (playing) el.play?.().catch(() => {})
        else el.pause()

        if (el.readyState >= 2) drawCoverTransformed(ctx, el, el.videoWidth, el.videoHeight, canvasW, canvasH)
      } else if (active.source_type === 'image' && active.source_url) {
        const img = getImage(active.source_url)
        if (img) {
          const kb = kenBurnsTransform(active, playheadSec)
          drawCoverTransformed(ctx, img, img.naturalWidth, img.naturalHeight, canvasW, canvasH, kb.scale, kb.x, kb.y)
        }
      }
      ctx.filter = 'none'
      ctx.globalAlpha = 1
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
      const fade = fadeMultiplier(active)(playheadSec - active.timeline_start_sec, active.timeline_end_sec - playheadSec)
      el.muted = track.muted || active.volume === 0
      el.volume = (active.volume ?? 1) * fade * duck
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
      drawCaption(ctx, active, canvasW, canvasH, playheadSec)
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
