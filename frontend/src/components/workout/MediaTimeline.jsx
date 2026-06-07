import { useState, useRef, useEffect, useCallback } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import api from '../../services/api'
import toast from 'react-hot-toast'

// ---------------------------------------------------------------------------
// HUD overlay rendered on top of the video while playing
// ---------------------------------------------------------------------------

function VideoHUD({ metrics, currentTime }) {
  if (!metrics || metrics.length === 0) return null
  const frame = metrics[Math.min(Math.floor(currentTime), metrics.length - 1)]
  if (!frame) return null

  return (
    <div className="absolute bottom-3 left-3 bg-black/60 backdrop-blur-sm text-white rounded-xl px-3 py-2 text-xs font-mono leading-relaxed pointer-events-none">
      {frame.km   != null && <div className="font-semibold text-sm">{frame.km.toFixed(2)} km</div>}
      {frame.speed != null && <div className="text-gray-200">{frame.speed.toFixed(1)} km/h</div>}
      {frame.hr   != null && <div className="text-red-300">{frame.hr} bpm ♥</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inline video player with HUD
// ---------------------------------------------------------------------------

function ClipPlayer({ clip, workoutId, onClose }) {
  const { t } = useTranslation('workouts')
  const videoRef = useRef(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [offsetAdjust, setOffsetAdjust] = useState(0)
  const [adjusting, setAdjusting] = useState(false)
  const qc = useQueryClient()

  const { data: metrics = [] } = useQuery({
    queryKey: ['media-metrics', clip.id],
    queryFn: () => api.get(`/api/workouts/${workoutId}/media/${clip.id}/metrics`).then(r => r.data),
    staleTime: Infinity,
  })

  useEffect(() => {
    const video = videoRef.current
    if (!video) return
    const onTime = () => setCurrentTime(video.currentTime)
    video.addEventListener('timeupdate', onTime)
    return () => video.removeEventListener('timeupdate', onTime)
  }, [])

  const resyncMutation = useMutation({
    mutationFn: () => api.post(`/api/workouts/${workoutId}/media/${clip.id}/resync`, {
      offset_adjust_sec: offsetAdjust,
    }),
    onSuccess: () => {
      qc.invalidateQueries(['workout-media', workoutId])
      qc.invalidateQueries(['media-metrics', clip.id])
      toast.success(t('strava.media.resynced'))
      setAdjusting(false)
    },
    onError: () => toast.error(t('strava.media.resyncFailed')),
  })

  return (
    <div className="mt-3 bg-gray-900 rounded-2xl overflow-hidden">
      {/* video */}
      <div className="relative">
        <video
          ref={videoRef}
          src={clip.r2_url}
          controls
          className="w-full max-h-[400px] object-contain bg-black"
          preload="metadata"
        />
        <VideoHUD metrics={metrics} currentTime={currentTime} />
        <button
          onClick={onClose}
          className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm hover:bg-black/80"
        >
          ✕
        </button>
      </div>

      {/* clip meta + offset adjustment */}
      <div className="px-4 py-3 flex flex-wrap items-center gap-3 text-xs text-gray-400">
        <span>{clip.original_filename || 'clip'}</span>
        {clip.km_start != null && clip.km_end != null && (
          <span className="text-gray-300 font-mono">
            {clip.km_start.toFixed(2)} – {clip.km_end.toFixed(2)} km
          </span>
        )}
        {clip.duration_sec != null && (
          <span>{Math.round(clip.duration_sec)}s</span>
        )}
        <button
          onClick={() => setAdjusting(v => !v)}
          className="ml-auto text-blue-400 hover:text-blue-300"
        >
          {t('strava.media.adjustSync')}
        </button>
      </div>

      {adjusting && (
        <div className="px-4 pb-3 space-y-2">
          <p className="text-xs text-gray-400">{t('strava.media.adjustDesc')}</p>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={-120} max={120} step={1}
              value={offsetAdjust}
              onChange={e => setOffsetAdjust(Number(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <span className="text-xs font-mono text-white w-16 text-right">
              {offsetAdjust >= 0 ? '+' : ''}{offsetAdjust}s
            </span>
          </div>
          <button
            onClick={() => resyncMutation.mutate()}
            disabled={resyncMutation.isPending || offsetAdjust === 0}
            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-40"
          >
            {resyncMutation.isPending ? t('strava.media.resyncing') : t('strava.media.applySync')}
          </button>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main MediaTimeline component
// ---------------------------------------------------------------------------

const CLIP_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899']

export function MediaTimeline({ workoutId, totalKm }) {
  const { t } = useTranslation('workouts')
  const qc = useQueryClient()
  const fileInputRef = useRef(null)
  const [selectedClipId, setSelectedClipId] = useState(null)
  const [uploadState, setUploadState] = useState(null) // { current, total, pct }

  const { data: clips = [], isLoading } = useQuery({
    queryKey: ['workout-media', workoutId],
    queryFn: () => api.get(`/api/workouts/${workoutId}/media`).then(r => r.data),
    staleTime: 30 * 1000,
  })

  const deleteMutation = useMutation({
    mutationFn: (mediaId) => api.delete(`/api/workouts/${workoutId}/media/${mediaId}`),
    onSuccess: (_, mediaId) => {
      if (selectedClipId === mediaId) setSelectedClipId(null)
      qc.invalidateQueries(['workout-media', workoutId])
      toast.success(t('strava.media.deleted'))
    },
    onError: () => toast.error(t('strava.media.deleteFailed')),
  })

  const handleFileChange = useCallback(async (e) => {
    const files = Array.from(e.target.files || [])
    if (!files.length) return
    e.target.value = ''

    let lastUploadedId = null
    for (let i = 0; i < files.length; i++) {
      const file = files[i]
      const formData = new FormData()
      formData.append('file', file)

      setUploadState({ current: i + 1, total: files.length, pct: 0 })
      try {
        const { data } = await api.post(
          `/api/workouts/${workoutId}/media`,
          formData,
          {
            headers: { 'Content-Type': 'multipart/form-data' },
            onUploadProgress: (ev) => {
              if (ev.total) setUploadState(s => ({ ...s, pct: Math.round((ev.loaded / ev.total) * 100) }))
            },
          }
        )
        qc.invalidateQueries(['workout-media', workoutId])
        lastUploadedId = data.id
        if (files.length === 1) {
          toast.success(
            data.km_start != null
              ? t('strava.media.uploadedAt', { km: data.km_start.toFixed(2) })
              : t('strava.media.uploaded')
          )
        }
      } catch (err) {
        const msg = err.response?.data?.error || t('strava.media.uploadFailed')
        toast.error(`${file.name}: ${msg}`)
      }
    }

    if (files.length > 1) toast.success(t('strava.media.uploaded'))
    if (lastUploadedId) setSelectedClipId(lastUploadedId)
    setUploadState(null)
  }, [workoutId, qc, t])

  const selectedClip = clips.find(c => c.id === selectedClipId) ?? null

  const safeTotalKm = totalKm && totalKm > 0 ? totalKm : null

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {t('strava.media.title')}
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadState !== null}
          className="text-[10px] text-blue-600 font-medium hover:text-blue-700 disabled:opacity-40"
        >
          + {t('strava.media.addClip')}
        </button>
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Upload progress */}
      {uploadState !== null && (
        <div className="mb-2">
          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 transition-all duration-300 rounded-full"
              style={{ width: `${uploadState.pct}%` }}
            />
          </div>
          <p className="text-[10px] text-gray-400 mt-1">
            {uploadState.total > 1
              ? `${uploadState.current} / ${uploadState.total} — ${uploadState.pct}%`
              : t('strava.media.uploading', { pct: uploadState.pct })}
          </p>
        </div>
      )}

      {/* Timeline bar */}
      {isLoading ? (
        <div className="h-8 bg-gray-100 rounded-full animate-pulse" />
      ) : clips.length === 0 && uploadState === null ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-2 border-dashed border-gray-200 rounded-xl py-5 text-xs text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
        >
          {t('strava.media.empty')}
        </button>
      ) : (
        <div className="relative">
          {/* Track */}
          <div className="relative h-8 bg-gray-100 rounded-full overflow-hidden">
            {clips.map((clip, i) => {
              if (clip.km_start == null || clip.km_end == null || !safeTotalKm) return null
              const left = (clip.km_start / safeTotalKm) * 100
              const width = Math.max(((clip.km_end - clip.km_start) / safeTotalKm) * 100, 1.5)
              const color = CLIP_COLORS[i % CLIP_COLORS.length]
              const isSelected = selectedClipId === clip.id
              return (
                <button
                  key={clip.id}
                  onClick={() => setSelectedClipId(isSelected ? null : clip.id)}
                  title={`${clip.km_start.toFixed(2)} – ${clip.km_end.toFixed(2)} km`}
                  className="absolute top-0 h-full transition-opacity hover:opacity-100"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: color,
                    opacity: isSelected ? 1 : 0.7,
                    minWidth: '6px',
                  }}
                />
              )
            })}
            {/* clips without km data shown at end */}
            {clips.filter(c => c.km_start == null).map((clip, i) => (
              <button
                key={clip.id}
                onClick={() => setSelectedClipId(selectedClipId === clip.id ? null : clip.id)}
                title={t('strava.media.unsynced')}
                className="absolute top-1 right-2 h-6 w-6 rounded-full flex items-center justify-center text-white text-[10px] font-bold"
                style={{ backgroundColor: CLIP_COLORS[(clips.indexOf(clip)) % CLIP_COLORS.length] }}
              >
                ?
              </button>
            ))}
          </div>

          {/* km axis labels */}
          {safeTotalKm && (
            <div className="flex justify-between text-[10px] text-gray-400 mt-0.5 px-0.5">
              <span>0 km</span>
              <span>{safeTotalKm.toFixed(2)} km</span>
            </div>
          )}

          {/* Clip labels below bar */}
          <div className="relative mt-1 h-5">
            {clips.map((clip, i) => {
              if (clip.km_start == null || !safeTotalKm) return null
              const left = (clip.km_start / safeTotalKm) * 100
              const color = CLIP_COLORS[i % CLIP_COLORS.length]
              return (
                <span
                  key={clip.id}
                  className="absolute text-[9px] font-mono whitespace-nowrap"
                  style={{ left: `${left}%`, color, transform: 'translateX(-50%)' }}
                >
                  {clip.km_start.toFixed(2)}–{clip.km_end.toFixed(2)}
                </span>
              )
            })}
          </div>
        </div>
      )}

      {/* Selected clip player */}
      {selectedClip && (
        <div>
          <ClipPlayer
            key={selectedClip.id}
            clip={selectedClip}
            workoutId={workoutId}
            onClose={() => setSelectedClipId(null)}
          />
          <div className="flex justify-end mt-1">
            <button
              onClick={() => deleteMutation.mutate(selectedClip.id)}
              disabled={deleteMutation.isPending}
              className="text-[10px] text-red-500 hover:text-red-700 disabled:opacity-40"
            >
              {t('strava.media.deleteClip')}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
