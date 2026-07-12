import { useRef, useState, useCallback, useEffect } from 'react'

/**
 * Authoritative playback clock for the canvas compositor, driven by
 * requestAnimationFrame + performance.now() deltas — NOT derived from any
 * single <video> element's timeupdate, since independent media elements
 * are not frame-synced by browsers.
 */
export function usePlaybackClock(durationSec) {
  const [playing, setPlaying] = useState(false)
  const [playheadSec, setPlayheadSecState] = useState(0)
  const rafRef = useRef(null)
  const lastTsRef = useRef(null)
  const playheadRef = useRef(0)
  const durationRef = useRef(durationSec)
  durationRef.current = durationSec

  const tick = useCallback((ts) => {
    if (lastTsRef.current == null) lastTsRef.current = ts
    const deltaSec = (ts - lastTsRef.current) / 1000
    lastTsRef.current = ts

    let next = playheadRef.current + deltaSec
    let keepGoing = true
    if (next >= durationRef.current) {
      next = durationRef.current
      keepGoing = false
    }
    playheadRef.current = next
    setPlayheadSecState(next)

    if (keepGoing) {
      rafRef.current = requestAnimationFrame(tick)
    } else {
      setPlaying(false)
      lastTsRef.current = null
    }
  }, [])

  const play = useCallback(() => {
    if (playheadRef.current >= durationRef.current) {
      playheadRef.current = 0
      setPlayheadSecState(0)
    }
    lastTsRef.current = null
    setPlaying(true)
    rafRef.current = requestAnimationFrame(tick)
  }, [tick])

  const pause = useCallback(() => {
    setPlaying(false)
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    lastTsRef.current = null
  }, [])

  const seek = useCallback((sec) => {
    const clamped = Math.max(0, Math.min(sec, durationRef.current))
    playheadRef.current = clamped
    setPlayheadSecState(clamped)
  }, [])

  useEffect(() => () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }, [])

  return { playing, playheadSec, play, pause, seek }
}
