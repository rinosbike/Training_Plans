import { useState, useMemo, useEffect, useRef } from 'react'
import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import EditorTabs from '../components/content/EditorTabs'
import Timeline from '../components/content/Timeline'
import ClipInspector from '../components/content/ClipInspector'
import CanvasPreview from '../components/content/CanvasPreview'
import VoiceoverPanel from '../components/content/VoiceoverPanel'
import { usePlaybackClock } from '../hooks/usePlaybackClock'
import { EXPORT_PRESETS, DEFAULT_PRESET } from '../constants/exportPresets'
import toast from 'react-hot-toast'

const TRACK_KIND_OPTIONS = ['video', 'image', 'audio', 'caption']

export default function ContentEditor() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { user } = useAuth()
  const qc = useQueryClient()

  const [selectedClipId, setSelectedClipId] = useState(null)
  const [draftClips, setDraftClips] = useState({})
  const [preset, setPreset] = useState(DEFAULT_PRESET)
  const [exporting, setExporting] = useState(false)
  const presetInitialized = useRef(false)

  const { data: story, isLoading } = useQuery({
    queryKey: ['content-story', id],
    queryFn: () => api.get(`/api/content/stories/${id}`).then(r => r.data),
  })

  useEffect(() => {
    if (story?.export_preset && !presetInitialized.current) {
      setPreset(story.export_preset)
      presetInitialized.current = true
    }
  }, [story?.export_preset])

  const tracks = story?.timeline?.tracks || []
  const serverClips = story?.timeline?.clips || []
  const clips = useMemo(
    () => serverClips.map(c => draftClips[c.id] ? { ...c, ...draftClips[c.id] } : c),
    [serverClips, draftClips]
  )
  const durationSec = useMemo(
    () => clips.reduce((m, c) => Math.max(m, c.timeline_end_sec), 10),
    [clips]
  )

  const { playing, playheadSec, play, pause, seek } = usePlaybackClock(durationSec)

  const invalidate = () => qc.invalidateQueries(['content-story', id])

  const upgrade = useMutation({
    mutationFn: () => api.post(`/api/content/stories/${id}/upgrade`),
    onSuccess: (r) => {
      invalidate()
      const warnings = r.data?.warnings || []
      if (warnings.length) warnings.forEach(w => toast(w, { icon: '⚠️' }))
      toast.success('Upgraded to the multi-track timeline editor')
    },
    onError: (e) => toast.error(e.response?.data?.error || 'Upgrade failed'),
  })

  const addTrack = useMutation({
    mutationFn: (kind) => api.post(`/api/content/stories/${id}/tracks`, { kind }),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to add track'),
  })

  const deleteTrack = useMutation({
    mutationFn: (trackId) => api.delete(`/api/content/stories/${id}/tracks/${trackId}`),
    onSuccess: () => { invalidate(); setSelectedClipId(null) },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to delete track'),
  })

  const updateClip = useMutation({
    mutationFn: ({ trackId, clipId, data }) =>
      api.put(`/api/content/stories/${id}/tracks/${trackId}/clips/${clipId}`, data),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.response?.data?.error || 'Update failed'),
  })

  const deleteClip = useMutation({
    mutationFn: ({ trackId, clipId }) =>
      api.delete(`/api/content/stories/${id}/tracks/${trackId}/clips/${clipId}`),
    onSuccess: () => { invalidate(); setSelectedClipId(null) },
    onError: (e) => toast.error(e.response?.data?.error || 'Delete failed'),
  })

  const uploadClip = useMutation({
    mutationFn: ({ trackId, file }) => {
      const form = new FormData()
      form.append('file', file)
      return api.post(`/api/content/stories/${id}/tracks/${trackId}/clips/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
    },
    onSuccess: invalidate,
    onError: (e) => toast.error(e.response?.data?.error || 'Upload failed'),
  })

  const addTextClip = useMutation({
    mutationFn: ({ trackId, data }) => api.post(`/api/content/stories/${id}/tracks/${trackId}/clips`, data),
    onSuccess: invalidate,
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to add caption'),
  })

  const updateStory = useMutation({
    mutationFn: (data) => api.put(`/api/content/stories/${id}`, data),
  })

  function handlePresetChange(newPreset) {
    setPreset(newPreset)
    updateStory.mutate({ export_preset: newPreset })
  }

  async function handleExport() {
    setExporting(true)
    toast('Composing video… this can take a few minutes for longer or more complex timelines', { icon: '🎬', duration: 280000, id: 'export-progress' })
    try {
      const resp = await api.get(`/api/content/stories/${id}/export`, {
        params: { preset },
        responseType: 'blob',
        timeout: 290000,
      })
      toast.dismiss('export-progress')
      const url = URL.createObjectURL(resp.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${story?.title || 'story'}.mp4`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Video exported!')
    } catch {
      toast.dismiss('export-progress')
      toast.error('Export failed — check server logs.')
    } finally {
      setExporting(false)
    }
  }

  if (user && !['admin', 'super_admin'].includes(user.role)) {
    return <Navigate to="/" replace />
  }

  if (isLoading) return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary-600" />
    </div>
  )

  if (!story) return <Navigate to="/content" replace />

  if (story.editor_mode !== 'tracks') {
    return (
      <div className="min-h-screen bg-gray-50 pb-nav">
        <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
          <div className="max-w-3xl mx-auto">
            <button onClick={() => navigate('/content')} className="text-white/70 text-sm mb-2 hover:text-white">← Content</button>
            <h1 className="text-xl font-bold">{story.title}</h1>
            <EditorTabs storyId={id} active="timeline" />
          </div>
        </div>
        <div className="max-w-3xl mx-auto px-4 py-10 flex justify-center">
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 max-w-sm text-center">
            <p className="text-sm text-gray-600 mb-4">
              This story still uses the classic scene editor. Upgrade it to the multi-track timeline
              editor to arrange separate video, image, audio and caption layers.
            </p>
            <button
              onClick={() => upgrade.mutate()}
              disabled={upgrade.isPending}
              className="bg-primary-600 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-primary-700 disabled:opacity-50"
            >
              {upgrade.isPending ? 'Upgrading…' : 'Upgrade to Timeline Editor'}
            </button>
          </div>
        </div>
        <BottomNav />
      </div>
    )
  }

  const selectedClip = clips.find(c => c.id === selectedClipId) || null
  const selectedTrack = selectedClip ? tracks.find(t => t.id === selectedClip.track_id) : null
  const activePreset = EXPORT_PRESETS[preset]

  function handleSelectClip(clipId) {
    setSelectedClipId(clipId)
    const clip = clips.find(c => c.id === clipId)
    if (clip) {
      if (playing) pause()
      seek(clip.timeline_start_sec)
    }
  }

  function handleChangeClip(clipId, updates) {
    setDraftClips(d => ({ ...d, [clipId]: { ...d[clipId], ...updates } }))
  }

  function handleCommitClip(clipId) {
    const draft = draftClips[clipId]
    if (!draft) return
    const clip = serverClips.find(c => c.id === clipId)
    if (!clip) return
    updateClip.mutate({ trackId: clip.track_id, clipId, data: draft })
    setDraftClips(d => { const next = { ...d }; delete next[clipId]; return next })
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <div className="max-w-3xl mx-auto">
          <button onClick={() => navigate('/content')} className="text-white/70 text-sm mb-2 hover:text-white">← Content</button>
          <h1 className="text-xl font-bold">{story.title}</h1>
          <EditorTabs storyId={id} active="timeline" />
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              onClick={() => (playing ? pause() : play())}
              className="w-9 h-9 rounded-full bg-primary-600 text-white flex items-center justify-center hover:bg-primary-700"
              title={playing ? 'Pause' : 'Play'}
            >
              {playing ? '⏸' : '▶'}
            </button>
            <span className="text-xs font-mono text-gray-500">{playheadSec.toFixed(1)}s / {durationSec.toFixed(1)}s</span>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={preset}
              onChange={e => handlePresetChange(e.target.value)}
              className="text-xs border border-gray-200 rounded-lg px-2 py-1.5 bg-white text-gray-700"
            >
              {Object.entries(EXPORT_PRESETS).map(([key, p]) => (
                <option key={key} value={key}>{p.label}</option>
              ))}
            </select>
            <button
              onClick={handleExport}
              disabled={exporting}
              className="text-xs font-medium bg-white border border-gray-200 px-3 py-1.5 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {exporting ? 'Exporting…' : 'Export'}
            </button>
          </div>
        </div>

        <CanvasPreview
          tracks={tracks}
          clips={clips}
          presetW={activePreset.width}
          presetH={activePreset.height}
          playheadSec={playheadSec}
          playing={playing}
          selectedClipId={selectedClipId}
          onChangeClip={handleChangeClip}
          onCommitClip={handleCommitClip}
        />

        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-gray-500 mr-1">Add track:</span>
          {TRACK_KIND_OPTIONS.map(kind => (
            <button
              key={kind}
              onClick={() => addTrack.mutate(kind)}
              disabled={addTrack.isPending}
              className="text-xs font-medium text-gray-600 bg-white border border-gray-200 px-2.5 py-1 rounded-lg hover:bg-gray-50 disabled:opacity-50"
            >
              + {kind}
            </button>
          ))}
        </div>

        <Timeline
          tracks={tracks}
          clips={clips}
          selectedClipId={selectedClipId}
          onSelectClip={handleSelectClip}
          onChangeClip={handleChangeClip}
          onCommitClip={handleCommitClip}
          onDeleteTrack={(trackId) => deleteTrack.mutate(trackId)}
          onUploadClip={(trackId, file) => uploadClip.mutate({ trackId, file })}
          onAddCaption={(trackId, text) => addTextClip.mutate({
            trackId,
            data: { text_content: text, timeline_start_sec: playheadSec, timeline_end_sec: playheadSec + 3 },
          })}
          uploading={uploadClip.isPending}
          playheadSec={playheadSec}
          onSeek={seek}
        />

        {selectedClip && selectedTrack && (
          <ClipInspector
            storyId={id}
            clip={selectedClip}
            track={selectedTrack}
            playheadSec={playheadSec}
            onUpdate={(data) => updateClip.mutate({ trackId: selectedTrack.id, clipId: selectedClip.id, data })}
            onDelete={() => deleteClip.mutate({ trackId: selectedTrack.id, clipId: selectedClip.id })}
            onTranscribed={invalidate}
            onDuplicated={invalidate}
            onSplit={invalidate}
          />
        )}

        <VoiceoverPanel storyId={id} tracks={tracks} onGenerated={invalidate} />
      </div>

      <BottomNav />
    </div>
  )
}
