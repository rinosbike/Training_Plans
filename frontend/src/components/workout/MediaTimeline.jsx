import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import api from '../../services/api'
import toast from 'react-hot-toast'

const CLIP_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899',
                     '#06b6d4', '#84cc16', '#f97316', '#6366f1']

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
// Inline video player with HUD and resync controls
// ---------------------------------------------------------------------------

function ClipPlayer({ clip, clipNumber, color, workoutId, onClose }) {
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
    <div className="mt-4 bg-gray-900 rounded-2xl overflow-hidden">
      <div className="relative">
        <video
          ref={videoRef}
          src={clip.r2_url}
          controls
          className="w-full max-h-[420px] object-contain bg-black"
          preload="metadata"
        />
        <VideoHUD metrics={metrics} currentTime={currentTime} />
        {/* Clip number badge */}
        <div
          className="absolute top-3 left-3 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-lg"
          style={{ backgroundColor: color }}
        >
          {clipNumber}
        </div>
        <button
          onClick={onClose}
          className="absolute top-2 right-2 bg-black/50 text-white rounded-full w-7 h-7 flex items-center justify-center text-sm hover:bg-black/80"
        >
          ✕
        </button>
      </div>

      <div className="px-4 py-3 flex flex-wrap items-center gap-3 text-xs text-gray-400">
        <span className="font-mono text-gray-500">{clip.original_filename || 'clip'}</span>
        {clip.km_start != null && clip.km_end != null && (
          <span className="text-gray-300 font-mono font-semibold">
            {clip.km_start.toFixed(2)} – {clip.km_end.toFixed(2)} km
          </span>
        )}
        {clip.duration_sec != null && (
          <span>{Math.round(clip.duration_sec)}s</span>
        )}
        {clip.km_start == null && (
          <span className="text-amber-400">{t('strava.media.unsynced')}</span>
        )}
        <button
          onClick={() => setAdjusting(v => !v)}
          className="ml-auto text-blue-400 hover:text-blue-300 text-xs"
        >
          {t('strava.media.adjustSync')}
        </button>
      </div>

      {adjusting && (
        <div className="px-4 pb-4 space-y-2">
          <p className="text-xs text-gray-400">{t('strava.media.adjustDesc')}</p>
          <div className="flex items-center gap-3">
            <input
              type="range"
              min={-14400} max={14400} step={30}
              value={offsetAdjust}
              onChange={e => setOffsetAdjust(Number(e.target.value))}
              className="flex-1 accent-blue-500"
            />
            <input
              type="number"
              value={offsetAdjust}
              onChange={e => setOffsetAdjust(Number(e.target.value))}
              className="w-20 text-xs font-mono bg-gray-800 text-white rounded px-2 py-1 text-right"
              placeholder="sec"
            />
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
// Km timeline bar — proportional colored segments with clip numbers
// ---------------------------------------------------------------------------

function TimelineBar({ sortedClips, totalKm, selectedId, onSelect }) {
  const syncedClips = sortedClips.filter(c => c.km_start != null)
  if (!syncedClips.length) return null

  return (
    <div className="mb-4">
      {/* Track */}
      <div className="relative h-14 bg-gray-100 rounded-xl overflow-hidden">
        {syncedClips.map((clip) => {
          const idx = sortedClips.indexOf(clip)
          const color = CLIP_COLORS[idx % CLIP_COLORS.length]
          const left  = (clip.km_start / totalKm) * 100
          const width = Math.max(((clip.km_end - clip.km_start) / totalKm) * 100, 0.8)
          const isSelected = selectedId === clip.id
          const clipNum = idx + 1
          const showLabel = width > 3

          return (
            <button
              key={clip.id}
              onClick={() => onSelect(isSelected ? null : clip.id)}
              title={`Clip ${clipNum} · ${clip.km_start.toFixed(2)}–${clip.km_end.toFixed(2)} km`}
              className="absolute top-0 h-full flex items-center justify-center transition-all hover:brightness-110 focus:outline-none"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: color,
                opacity: isSelected ? 1 : 0.75,
                minWidth: '6px',
                outline: isSelected ? `2px solid ${color}` : 'none',
                outlineOffset: '-2px',
              }}
            >
              {showLabel && (
                <span className="text-white text-xs font-bold select-none drop-shadow">
                  {clipNum}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Km axis */}
      <div className="flex justify-between text-[10px] text-gray-400 mt-1 px-0.5">
        <span>0 km</span>
        <span>{(totalKm / 2).toFixed(0)} km</span>
        <span>{totalKm.toFixed(1)} km</span>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Scrollable clip list — all clips numbered with quick stats
// ---------------------------------------------------------------------------

function ClipList({ sortedClips, selectedId, onSelect, onDelete, deletingId }) {
  const { t } = useTranslation('workouts')

  if (!sortedClips.length) return null

  return (
    <div className="space-y-1.5">
      {sortedClips.map((clip, idx) => {
        const color = CLIP_COLORS[idx % CLIP_COLORS.length]
        const isSelected = selectedId === clip.id
        const clipNum = idx + 1
        const hasSyncedKm = clip.km_start != null && clip.km_end != null
        const durationStr = clip.duration_sec != null
          ? clip.duration_sec >= 60
            ? `${Math.floor(clip.duration_sec / 60)}m ${Math.round(clip.duration_sec % 60)}s`
            : `${Math.round(clip.duration_sec)}s`
          : null

        return (
          <div
            key={clip.id}
            className={`flex items-center gap-3 rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${
              isSelected ? 'bg-gray-100 ring-1 ring-gray-300' : 'hover:bg-gray-50'
            }`}
            onClick={() => onSelect(isSelected ? null : clip.id)}
          >
            {/* Color badge with clip number */}
            <div
              className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-white text-xs font-bold shadow-sm"
              style={{ backgroundColor: color }}
            >
              {clipNum}
            </div>

            {/* Main info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                {hasSyncedKm ? (
                  <span className="text-xs font-semibold font-mono text-gray-800">
                    {clip.km_start.toFixed(2)} – {clip.km_end.toFixed(2)} km
                  </span>
                ) : (
                  <span className="text-xs font-medium text-amber-600">
                    {t('strava.media.unsynced')}
                  </span>
                )}
                {durationStr && (
                  <span className="text-[11px] text-gray-400">{durationStr}</span>
                )}
              </div>
              {clip.original_filename && (
                <p className="text-[10px] text-gray-400 truncate mt-0.5 font-mono">
                  {clip.original_filename}
                </p>
              )}
            </div>

            {/* Status + delete */}
            <div className="flex items-center gap-2 flex-shrink-0">
              {isSelected && (
                <span className="text-[10px] text-blue-500 font-medium">Playing</span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); onDelete(clip.id) }}
                disabled={deletingId === clip.id}
                className="text-gray-300 hover:text-red-400 disabled:opacity-30 transition-colors text-xs px-1"
                title={t('strava.media.deleteClip')}
              >
                ✕
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main MediaTimeline component
// ---------------------------------------------------------------------------

export function MediaTimeline({ workoutId, totalKm }) {
  const { t } = useTranslation('workouts')
  const qc = useQueryClient()
  const fileInputRef = useRef(null)
  const [selectedClipId, setSelectedClipId] = useState(null)
  const [uploadState, setUploadState] = useState(null) // { current, total, pct }
  const [deletingId, setDeletingId] = useState(null)

  const { data: clips = [], isLoading } = useQuery({
    queryKey: ['workout-media', workoutId],
    queryFn: () => api.get(`/api/workouts/${workoutId}/media`).then(r => r.data),
    staleTime: 30 * 1000,
  })

  // Sorted: synced clips by km_start first, then unsynced
  const sortedClips = useMemo(() => {
    const synced   = clips.filter(c => c.km_start != null).sort((a, b) => a.km_start - b.km_start)
    const unsynced = clips.filter(c => c.km_start == null)
    return [...synced, ...unsynced]
  }, [clips])

  const deleteMutation = useMutation({
    mutationFn: (mediaId) => api.delete(`/api/workouts/${workoutId}/media/${mediaId}`),
    onMutate: (mediaId) => setDeletingId(mediaId),
    onSuccess: (_, mediaId) => {
      if (selectedClipId === mediaId) setSelectedClipId(null)
      qc.invalidateQueries(['workout-media', workoutId])
      toast.success(t('strava.media.deleted'))
    },
    onError: () => toast.error(t('strava.media.deleteFailed')),
    onSettled: () => setDeletingId(null),
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

  const selectedClip  = sortedClips.find(c => c.id === selectedClipId) ?? null
  const selectedIdx   = selectedClip ? sortedClips.indexOf(selectedClip) : -1
  const selectedColor = selectedIdx >= 0 ? CLIP_COLORS[selectedIdx % CLIP_COLORS.length] : '#3b82f6'

  const safeTotalKm = totalKm && totalKm > 0 ? totalKm : null

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {t('strava.media.title')}
          {sortedClips.length > 0 && (
            <span className="ml-1.5 text-gray-400 font-normal normal-case">
              ({sortedClips.length} {sortedClips.length === 1 ? 'clip' : 'clips'})
            </span>
          )}
        </p>
        <button
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadState !== null}
          className="text-[11px] text-blue-600 font-medium hover:text-blue-700 disabled:opacity-40"
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
        <div className="mb-3">
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

      {/* Content */}
      {isLoading ? (
        <div className="h-14 bg-gray-100 rounded-xl animate-pulse" />
      ) : sortedClips.length === 0 && uploadState === null ? (
        <button
          onClick={() => fileInputRef.current?.click()}
          className="w-full border-2 border-dashed border-gray-200 rounded-xl py-6 text-xs text-gray-400 hover:border-blue-300 hover:text-blue-500 transition-colors"
        >
          {t('strava.media.empty')}
        </button>
      ) : (
        <>
          {/* Proportional km timeline bar */}
          {safeTotalKm && (
            <TimelineBar
              sortedClips={sortedClips}
              totalKm={safeTotalKm}
              selectedId={selectedClipId}
              onSelect={setSelectedClipId}
            />
          )}

          {/* Numbered clip list — all clips visible */}
          <ClipList
            sortedClips={sortedClips}
            selectedId={selectedClipId}
            onSelect={setSelectedClipId}
            onDelete={(id) => deleteMutation.mutate(id)}
            deletingId={deletingId}
          />

          {/* Player for active clip */}
          {selectedClip && (
            <ClipPlayer
              key={selectedClip.id}
              clip={selectedClip}
              clipNumber={selectedIdx + 1}
              color={selectedColor}
              workoutId={workoutId}
              onClose={() => setSelectedClipId(null)}
            />
          )}
        </>
      )}
    </div>
  )
}
