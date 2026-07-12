import { useState } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'

export default function ContentPreview() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()

  const [previewSceneIdx, setPreviewSceneIdx] = useState(0)
  const [previewClipIdx, setPreviewClipIdx] = useState(0)

  if (user && !['admin', 'super_admin'].includes(user.role)) {
    return <Navigate to="/" replace />
  }

  const { data: story, isLoading } = useQuery({
    queryKey: ['content-story', id],
    queryFn: () => api.get(`/api/content/stories/${id}`).then(r => r.data),
  })

  if (isLoading) return (
    <div className="flex items-center justify-center h-screen bg-black">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white" />
    </div>
  )

  if (!story) return <Navigate to="/content" replace />

  const scenes = story.scenes || []
  if (scenes.length === 0) return <Navigate to={`/content/${id}`} replace />

  const scene = scenes[previewSceneIdx]
  if (!scene) return <Navigate to={`/content/${id}`} replace />

  const clips = scene.clip_urls || []
  const clip = clips[previewClipIdx] || null
  const isVid = clip && /\.(mp4|mov|webm)$/i.test(clip)
  const canPrev = previewSceneIdx > 0
  const canNext = previewSceneIdx < scenes.length - 1

  function goScene(delta) {
    const next = previewSceneIdx + delta
    if (next < 0 || next >= scenes.length) return
    setPreviewSceneIdx(next)
    setPreviewClipIdx(0)
  }

  return (
    <div className="fixed inset-0 bg-black z-50 flex flex-col select-none">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-safe pt-10 pb-2">
        <span className="text-white/50 text-xs font-mono tracking-widest">
          {previewSceneIdx + 1} / {scenes.length}
        </span>
        <button
          onClick={() => navigate(`/content/${id}`)}
          className="text-white/60 hover:text-white text-2xl leading-none"
        >×</button>
      </div>

      {/* Progress bar */}
      <div className="flex gap-0.5 px-4 mb-3">
        {scenes.map((_, i) => (
          <button
            key={i}
            onClick={() => { setPreviewSceneIdx(i); setPreviewClipIdx(0) }}
            className="flex-1 h-0.5 rounded-full overflow-hidden bg-white/20"
          >
            <div className={`h-full bg-white ${i <= previewSceneIdx ? 'w-full' : 'w-0'}`} />
          </button>
        ))}
      </div>

      {/* 9:16 frame */}
      <div className="flex-1 flex items-center justify-center px-4">
        <div className="relative w-full max-w-[300px] aspect-[9/16] rounded-2xl overflow-hidden bg-gray-900 shadow-2xl">
          {clip ? (
            isVid ? (
              <video key={clip} src={clip} className="w-full h-full object-cover" autoPlay loop muted playsInline />
            ) : (
              <img key={clip} src={clip} alt="" className="w-full h-full object-cover" />
            )
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <span className="text-gray-500 text-sm">No clip yet</span>
            </div>
          )}

          {/* Gradient */}
          <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-transparent to-black/75 pointer-events-none" />

          {/* Duration badge top-left */}
          {scene.duration_sec && (
            <div className="absolute top-3 left-3 bg-black/50 text-white/70 text-[10px] px-2 py-0.5 rounded-full">
              {scene.duration_sec}s
            </div>
          )}

          {/* Overlay text — centred at bottom like a Reel */}
          {scene.overlay_text && (
            <div className="absolute bottom-10 inset-x-0 px-4 pointer-events-none">
              <p
                className="text-white text-base font-extrabold text-center leading-snug"
                style={{ textShadow: '0 2px 12px rgba(0,0,0,0.9), 0 0 4px rgba(0,0,0,0.8)' }}
              >
                {scene.overlay_text}
              </p>
            </div>
          )}

          {/* Clip dots — bottom center */}
          {clips.length > 1 && (
            <div className="absolute bottom-3 inset-x-0 flex justify-center gap-1.5">
              {clips.map((_, ci) => (
                <button
                  key={ci}
                  onClick={() => setPreviewClipIdx(ci)}
                  className={`w-1.5 h-1.5 rounded-full transition-all ${ci === previewClipIdx ? 'bg-white scale-125' : 'bg-white/40'}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Description */}
      {scene.description && (
        <p className="text-white/40 text-xs text-center px-8 py-2 leading-relaxed line-clamp-2">
          {scene.description}
        </p>
      )}

      {/* Navigation row */}
      <div className="flex items-center justify-between px-6 pb-10 pt-2">
        <button
          onClick={() => goScene(-1)}
          disabled={!canPrev}
          className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white text-lg disabled:opacity-20 transition-colors"
        >←</button>

        {/* Thumbnail strip */}
        <div className="flex gap-1.5 overflow-x-auto py-1 max-w-[160px] scrollbar-hide">
          {scenes.map((s, i) => {
            const thumb = (s.clip_urls || [])[0]
            return (
              <button
                key={s.id}
                onClick={() => { setPreviewSceneIdx(i); setPreviewClipIdx(0) }}
                className={`flex-none w-8 h-8 rounded-lg overflow-hidden border-2 transition-all ${i === previewSceneIdx ? 'border-white' : 'border-transparent opacity-40'}`}
              >
                {thumb ? (
                  <img src={thumb} alt="" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full bg-gray-700 flex items-center justify-center text-[8px] text-gray-400">{i + 1}</div>
                )}
              </button>
            )
          })}
        </div>

        <button
          onClick={() => goScene(1)}
          disabled={!canNext}
          className="w-11 h-11 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white text-lg disabled:opacity-20 transition-colors"
        >→</button>
      </div>

      {/* Script shortcut */}
      {story.generated_script && (
        <div className="border-t border-white/10 px-4 py-3">
          <button
            onClick={() => navigate(`/content/${id}`)}
            className="w-full text-xs text-primary-400 hover:text-primary-300 font-medium text-center"
          >
            View generated script →
          </button>
        </div>
      )}
    </div>
  )
}
