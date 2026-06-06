import { useState, useRef } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import SceneCard from '../components/content/SceneCard'
import toast from 'react-hot-toast'

export default function ContentStory() {
  const { t } = useTranslation('content')
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()

  const [editingField, setEditingField] = useState(null)
  const [fieldValue, setFieldValue] = useState('')
  const [showScript, setShowScript] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [previewSceneIdx, setPreviewSceneIdx] = useState(0)
  const [previewClipIdx, setPreviewClipIdx] = useState(0)
  const [copied, setCopied] = useState(false)
  const [exporting, setExporting] = useState(false)

  if (user && !['admin', 'super_admin'].includes(user.role)) {
    return <Navigate to="/" replace />
  }

  const { data: story, isLoading } = useQuery({
    queryKey: ['content-story', id],
    queryFn: () => api.get(`/api/content/stories/${id}`).then(r => r.data),
  })

  const updateStory = useMutation({
    mutationFn: (data) => api.put(`/api/content/stories/${id}`, data),
    onSuccess: () => qc.invalidateQueries(['content-story', id]),
    onError: (e) => toast.error(e.response?.data?.error || 'Update failed'),
  })

  const addScene = useMutation({
    mutationFn: () => api.post(`/api/content/stories/${id}/scenes`, {
      description: '', overlay_text: '', duration_sec: null,
    }),
    onSuccess: () => qc.invalidateQueries(['content-story', id]),
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to add scene'),
  })

  const generateScript = useMutation({
    mutationFn: () => api.post(`/api/content/stories/${id}/generate`),
    onSuccess: (r) => {
      qc.invalidateQueries(['content-story', id])
      setShowScript(true)
      toast.success('Script generated!')
    },
    onError: (e) => toast.error(e.response?.data?.error || t('generate.generateFailed', { defaultValue: t('errors.generateFailed') })),
  })

  async function handleExport() {
    setExporting(true)
    try {
      const resp = await api.get(`/api/content/stories/${id}/export`, { responseType: 'blob' })
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${story?.title || 'story'}.zip`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed. Try again.')
    } finally {
      setExporting(false)
    }
  }

  function startEdit(field, value) {
    setEditingField(field)
    setFieldValue(value || '')
  }

  function saveField() {
    if (!editingField) return
    updateStory.mutate({ [editingField]: fieldValue })
    setEditingField(null)
  }

  function copyScript() {
    if (!story?.generated_script) return
    navigator.clipboard.writeText(story.generated_script).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
    </div>
  )

  if (!story) return <Navigate to="/content" replace />

  const scenes = story.scenes || []

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      {/* Header */}
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <div className="max-w-lg mx-auto">
          <button onClick={() => navigate('/content')} className="text-white/70 text-sm mb-2 hover:text-white">
            ← Content
          </button>
          {/* Editable title */}
          {editingField === 'title' ? (
            <input
              autoFocus
              className="text-xl font-bold bg-white/20 rounded-lg px-2 py-1 w-full outline-none"
              value={fieldValue}
              onChange={e => setFieldValue(e.target.value)}
              onBlur={saveField}
              onKeyDown={e => e.key === 'Enter' && saveField()}
            />
          ) : (
            <h1
              className="text-xl font-bold cursor-pointer hover:opacity-80"
              onClick={() => startEdit('title', story.title)}
              title="Click to edit"
            >
              {story.title}
            </h1>
          )}
          {/* Theme & goal */}
          {editingField === 'theme' ? (
            <input autoFocus className="text-sm bg-white/20 rounded px-2 py-0.5 mt-1 w-full outline-none"
              value={fieldValue} onChange={e => setFieldValue(e.target.value)}
              onBlur={saveField} onKeyDown={e => e.key === 'Enter' && saveField()} />
          ) : (
            <p className="text-sm text-white/80 mt-1 cursor-pointer hover:text-white"
              onClick={() => startEdit('theme', story.theme)}>
              {story.theme || <span className="italic opacity-60">Add theme…</span>}
            </p>
          )}
          {editingField === 'goal' ? (
            <input autoFocus className="text-xs bg-white/20 rounded px-2 py-0.5 mt-0.5 w-full outline-none"
              value={fieldValue} onChange={e => setFieldValue(e.target.value)}
              onBlur={saveField} onKeyDown={e => e.key === 'Enter' && saveField()} />
          ) : (
            <p className="text-xs text-white/60 mt-0.5 cursor-pointer hover:text-white/80"
              onClick={() => startEdit('goal', story.goal)}>
              {story.goal ? `Goal: ${story.goal}` : <span className="italic">Add goal…</span>}
            </p>
          )}
        </div>
      </div>

      {/* Action bar */}
      <div className="max-w-lg mx-auto px-4 py-3 flex gap-2">
        <button
          onClick={() => { setPreviewSceneIdx(0); setPreviewClipIdx(0); setShowPreview(true) }}
          className="px-3 bg-white border border-gray-200 text-sm rounded-xl hover:bg-gray-50"
          title="Reel preview"
        >
          🎞
        </button>
        <button
          onClick={() => generateScript.mutate()}
          disabled={generateScript.isPending}
          className="flex-1 bg-primary-600 text-white text-sm font-medium py-2.5 rounded-xl hover:bg-primary-700 disabled:opacity-50 transition-colors"
        >
          {generateScript.isPending ? t('generate.generating') : t('generate.button')}
        </button>
        {story.generated_script && (
          <button
            onClick={() => setShowScript(true)}
            className="px-3 bg-white border border-gray-200 text-sm rounded-xl hover:bg-gray-50"
          >
            📄
          </button>
        )}
        <button
          onClick={handleExport}
          disabled={exporting}
          className="px-4 bg-white border border-gray-200 text-sm font-medium rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {exporting ? t('export.exporting') : t('export.button')}
        </button>
      </div>

      {/* Scenes */}
      <div className="max-w-lg mx-auto px-4 space-y-3 pb-4">
        {scenes.map((scene, index) => (
          <SceneCard
            key={scene.id}
            scene={scene}
            storyId={id}
            isFirst={index === 0}
            isLast={index === scenes.length - 1}
            onUpdated={() => qc.invalidateQueries(['content-story', id])}
          />
        ))}

        <button
          onClick={() => addScene.mutate()}
          disabled={addScene.isPending}
          className="w-full border-2 border-dashed border-gray-200 text-gray-400 text-sm py-4 rounded-xl hover:border-primary-400 hover:text-primary-500 transition-colors"
        >
          {addScene.isPending ? '…' : `+ ${t('scene.addScene')}`}
        </button>
      </div>

      {/* Reel preview — scene-by-scene immersive view */}
      {showPreview && (() => {
        const scene = scenes[previewSceneIdx]
        if (!scene) return null
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
                onClick={() => setShowPreview(false)}
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
                  onClick={() => { setShowPreview(false); setShowScript(true) }}
                  className="w-full text-xs text-primary-400 hover:text-primary-300 font-medium text-center"
                >
                  View generated script →
                </button>
              </div>
            )}
          </div>
        )
      })()}

      {/* Generated script panel */}
      {showScript && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg max-h-[80vh] flex flex-col shadow-2xl">
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
              <h2 className="font-semibold text-gray-900">{t('generate.title')}</h2>
              <div className="flex gap-2">
                <button
                  onClick={copyScript}
                  className="text-sm text-primary-600 font-medium hover:text-primary-700"
                >
                  {copied ? t('generate.copied') : t('generate.copy')}
                </button>
                <button onClick={() => setShowScript(false)} className="text-gray-400 hover:text-gray-600 text-xl leading-none">×</button>
              </div>
            </div>
            <div className="overflow-y-auto p-5">
              <pre className="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed">
                {story.generated_script}
              </pre>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}
