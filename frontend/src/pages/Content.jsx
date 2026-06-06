import { useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'

const STATUS_STYLE = {
  draft:    'bg-gray-100 text-gray-600',
  ready:    'bg-green-100 text-green-700',
  exported: 'bg-blue-100 text-blue-700',
}

export default function Content() {
  const { t } = useTranslation('content')
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ title: '', theme: '', goal: '' })
  const [deleteId, setDeleteId] = useState(null)

  if (user && !['admin', 'super_admin'].includes(user.role)) {
    return <Navigate to="/" replace />
  }

  const { data: stories = [], isLoading } = useQuery({
    queryKey: ['content-stories'],
    queryFn: () => api.get('/api/content/stories').then(r => r.data),
  })

  const createStory = useMutation({
    mutationFn: (data) => api.post('/api/content/stories', data),
    onSuccess: (r) => {
      qc.invalidateQueries(['content-stories'])
      setShowForm(false)
      setForm({ title: '', theme: '', goal: '' })
      navigate(`/content/${r.data.id}`)
    },
    onError: (e) => toast.error(e.response?.data?.error || t('errors.titleRequired')),
  })

  const deleteStory = useMutation({
    mutationFn: (id) => api.delete(`/api/content/stories/${id}`),
    onSuccess: () => { qc.invalidateQueries(['content-stories']); setDeleteId(null) },
    onError: (e) => toast.error(e.response?.data?.error || 'Delete failed'),
  })

  function handleCreate(e) {
    e.preventDefault()
    if (!form.title.trim()) { toast.error(t('errors.titleRequired')); return }
    createStory.mutate(form)
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      {/* Header */}
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <div className="max-w-lg mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold">{t('title')}</h1>
          <button
            onClick={() => setShowForm(v => !v)}
            className="bg-white/20 hover:bg-white/30 text-white text-sm font-medium px-3 py-1.5 rounded-lg transition-colors"
          >
            {showForm ? t('story.cancel', { defaultValue: 'Cancel' }) : t('newStory')}
          </button>
        </div>
      </div>

      <div className="max-w-lg mx-auto px-4 py-4 space-y-4">
        {/* New story form */}
        {showForm && (
          <form onSubmit={handleCreate} className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('story.title')} *</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder={t('story.titlePlaceholder')}
                value={form.title}
                onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('story.theme')}</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder={t('story.themePlaceholder')}
                value={form.theme}
                onChange={e => setForm(f => ({ ...f, theme: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">{t('story.goal')}</label>
              <input
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                placeholder={t('story.goalPlaceholder')}
                value={form.goal}
                onChange={e => setForm(f => ({ ...f, goal: e.target.value }))}
              />
            </div>
            <div className="flex gap-2 pt-1">
              <button
                type="submit"
                disabled={createStory.isPending}
                className="flex-1 bg-primary-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50 transition-colors"
              >
                {createStory.isPending ? '…' : t('newStory')}
              </button>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="px-4 text-sm text-gray-500 hover:text-gray-700"
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Stories list */}
        {isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
          </div>
        ) : stories.length === 0 ? (
          <p className="text-center text-gray-500 py-12 text-sm">{t('noStories')}</p>
        ) : (
          stories.map(story => (
            <div
              key={story.id}
              className="bg-white rounded-xl shadow-sm border border-gray-100 p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <button
                  className="text-left flex-1 min-w-0"
                  onClick={() => navigate(`/content/${story.id}`)}
                >
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-gray-900 text-sm">{story.title}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[story.status] || STATUS_STYLE.draft}`}>
                      {t(`story.status.${story.status}`, { defaultValue: story.status })}
                    </span>
                  </div>
                  {story.theme && <p className="text-xs text-gray-500 mt-0.5 truncate">{story.theme}</p>}
                  <p className="text-xs text-gray-400 mt-1">
                    {t('story.sceneCount', { count: story.scene_count, defaultValue: `${story.scene_count} scenes` })}
                    {' · '}
                    {new Date(story.created_at).toLocaleDateString()}
                  </p>
                </button>
                <button
                  onClick={() => setDeleteId(story.id)}
                  className="text-gray-300 hover:text-red-500 transition-colors p-1 shrink-0"
                  aria-label="Delete"
                >
                  🗑
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Delete confirmation */}
      {deleteId && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <p className="text-sm text-gray-700 mb-4">Delete this story and all its clips? This cannot be undone.</p>
            <div className="flex gap-3">
              <button
                onClick={() => deleteStory.mutate(deleteId)}
                disabled={deleteStory.isPending}
                className="flex-1 bg-red-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteStory.isPending ? '…' : 'Delete'}
              </button>
              <button
                onClick={() => setDeleteId(null)}
                className="flex-1 border border-gray-200 text-sm py-2 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <BottomNav />
    </div>
  )
}
