import { useEffect, useRef } from 'react'
import WaveSurfer from 'wavesurfer.js'

export default function AudioWaveform({ url }) {
  const containerRef = useRef(null)

  useEffect(() => {
    if (!containerRef.current || !url) return
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: 'rgba(255,255,255,0.6)',
      progressColor: 'rgba(255,255,255,0.6)',
      cursorWidth: 0,
      height: 'auto',
      interact: false,
      hideScrollbar: true,
      normalize: true,
      url,
    })
    return () => ws.destroy()
  }, [url])

  return <div ref={containerRef} className="absolute inset-0 pointer-events-none opacity-80" />
}
