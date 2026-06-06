import { useState, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import api from '../../services/api'
import toast from 'react-hot-toast'

const ACCEPTED = 'video/mp4,video/quicktime,video/webm,image/jpeg,image/png,image/webp'

export default function SceneCard({ scene, storyId, isFirst, isLast, onUpdated }) {
  const { t } = useTranslation('content')
  const fileRef = useRef(null)
  const qc = useQueryClient()

  const [uploading, setUploading] = useState(false)
  const [deleteClipUrl, setDeleteClipUrl] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [lightboxUrl, setLightboxUrl] = useState(null)

  const updateScene = useMutation({
    mutationFn: (data) => api.put(`/api/content/stories/${storyId}/scenes/${scene.id}`, data),
    onSuccess: onUpdated,
    onError: (e) => toast.error(e.response?.data?.error || 'Update failed'),
  })

  const deleteScene = useMutation({
    mutationFn: () => api.delete(`/api/content/stories/${storyId}/scenes/${scene.id}`),
    onSuccess: onUpdated,
    onError: (e) => toast.error(e.response?.data?.error || 'Delete failed'),
  })

  const removeClip = useMutation({
    mutationFn: (url) => api.delete(`/api/content/stories/${storyId}/scenes/${scene.id}/clips`, { data: { url } }),
    onSuccess: () => { onUpdated(); setDeleteClipUrl(null) },
    onError: (e) => toast.error(e.response?.data?.error || 'Remove failed'),
  })

  const moveScene = useMutation({
    mutationFn: (newPos) => api.put(`/api/content/stories/${storyId}/scenes/${scene.id}`, { position: newPos }),
    onSuccess: onUpdated,
    onError: (e) => toast.error('Reorder failed'),
  })

  function handleBlur(field, value) {
    const parsed = field === 'duration_sec' ? (parseInt(value) || null) : (value.trim() || null)
    if (parsed !== (scene[field] || null)) {
      updateScene.mutate({ [field]: parsed })
    }
  }

  async function handleFileChange(e) {
    const file = e.target.files?.[0]
    if (!file) return
    if (file.size > 150 * 1024 * 1024) { toast.error(t('errors.fileTooLarge')); return }

    setUploading(true)
    const form = new FormData()
    form.append('file', file)
    try {
      await api.post(`/api/content/stories/${storyId}/scenes/${scene.id}/clips`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      onUpdated()
      toast.success('Clip uploaded')
    } catch (err) {
      toast.error(err.response?.data?.error || t('errors.uploadFailed'))
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  const clips = scene.clip_urls || []
  const isVideo = (url) => /\.(mp4|mov|webm)$/i.test(url)

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      {/* Scene header */}
      <div className="flex items-center justify-between px-4 py-2.5 bg-gray-50 border-b border-gray-100">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {t('scene.title', { number: scene.position })}
        </span>
        <div className="flex items-center gap-1">
          {!isFirst && (
            <button
              onClick={() => moveScene.mutate(scene.position - 1)}
              className="text-gray-400 hover:text-gray-600 text-sm px-1"
              title={t('scene.moveUp')}
            >↑</button>
          )}
          {!isLast && (
            <button
              onClick={() => moveScene.mutate(scene.position + 1)}
              className="text-gray-400 hover:text-gray-600 text-sm px-1"
              title={t('scene.moveDown')}
            >↓</button>
          )}
          <button
            onClick={() => setConfirmDelete(true)}
            className="text-gray-300 hover:text-red-500 transition-colors text-sm px-1 ml-1"
            title={t('scene.deleteScene')}
          >🗑</button>
        </div>
      </div>

      <div className="p-4 space-y-3">
        {/* Director note */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('scene.description')}</label>
          <textarea
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
            rows={2}
            placeholder={t('scene.descriptionPlaceholder')}
            defaultValue={scene.description || ''}
            onBlur={e => handleBlur('description', e.target.value)}
          />
        </div>

        {/* Overlay text */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('scene.overlayText')}</label>
          <input
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder={t('scene.overlayPlaceholder')}
            defaultValue={scene.overlay_text || ''}
            onBlur={e => handleBlur('overlay_text', e.target.value)}
          />
        </div>

        {/* Duration */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">{t('scene.duration')}</label>
          <input
            type="number"
            min={1}
            className="w-28 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            placeholder={t('scene.durationPlaceholder')}
            defaultValue={scene.duration_sec || ''}
            onBlur={e => handleBlur('duration_sec', e.target.value)}
          />
        </div>

        {/* Clips */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-2">{t('scene.clips')}</label>
          {clips.length === 0 ? (
            <p className="text-xs text-gray-400">{t('scene.noClips')}</p>
          ) : (
            <div className="flex flex-wrap gap-2 mb-2">
              {clips.map((url) => (
                <div key={url} className="relative group">
                  <button
                    onClick={() => setLightboxUrl(url)}
                    className="block w-20 h-20 rounded-lg overflow-hidden focus:outline-none focus:ring-2 focus:ring-primary-500"
                  >
                    {isVideo(url) ? (
                      <video
                        src={url}
                        className="w-full h-full object-cover bg-black"
                        muted
                        preload="metadata"
                      />
                    ) : (
                      <img src={url} alt="" className="w-full h-full object-cover" />
                    )}
                  </button>
                  <button
                    onClick={() => setDeleteClipUrl(url)}
                    className="absolute top-0.5 right-0.5 bg-black/60 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                    title={t('scene.deleteClip')}
                  >×</button>
                </div>
              ))}
            </div>
          )}
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPTED}
            className="hidden"
            onChange={handleFileChange}
          />
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="text-xs font-medium text-primary-600 hover:text-primary-700 border border-primary-200 hover:border-primary-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {uploading ? t('scene.uploading') : `+ ${t('scene.uploadClip')}`}
          </button>
        </div>
      </div>

      {/* Delete scene confirmation */}
      {confirmDelete && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <p className="text-sm text-gray-700 mb-4">
              Delete Scene {scene.position} and all its clips? This cannot be undone.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => deleteScene.mutate()}
                disabled={deleteScene.isPending}
                className="flex-1 bg-red-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {deleteScene.isPending ? '…' : 'Delete'}
              </button>
              <button
                onClick={() => setConfirmDelete(false)}
                className="flex-1 border border-gray-200 text-sm py-2 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Lightbox */}
      {lightboxUrl && (
        <div
          className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4"
          onClick={() => setLightboxUrl(null)}
        >
          <button
            className="absolute top-4 right-4 text-white/60 hover:text-white text-3xl leading-none z-10"
            onClick={() => setLightboxUrl(null)}
          >×</button>
          {isVideo(lightboxUrl) ? (
            <video
              src={lightboxUrl}
              className="max-w-full max-h-[90vh] rounded-xl"
              controls
              autoPlay
              onClick={e => e.stopPropagation()}
            />
          ) : (
            <img
              src={lightboxUrl}
              alt=""
              className="max-w-full max-h-[90vh] rounded-xl object-contain"
              onClick={e => e.stopPropagation()}
            />
          )}
        </div>
      )}

      {/* Delete clip confirmation */}
      {deleteClipUrl && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl p-6 max-w-sm w-full shadow-xl">
            <p className="text-sm text-gray-700 mb-4">Remove this clip from the scene?</p>
            <div className="flex gap-3">
              <button
                onClick={() => removeClip.mutate(deleteClipUrl)}
                disabled={removeClip.isPending}
                className="flex-1 bg-red-600 text-white text-sm font-medium py-2 rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {removeClip.isPending ? '…' : 'Remove'}
              </button>
              <button
                onClick={() => setDeleteClipUrl(null)}
                className="flex-1 border border-gray-200 text-sm py-2 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
