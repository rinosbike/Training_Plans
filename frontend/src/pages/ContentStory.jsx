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
