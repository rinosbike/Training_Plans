import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '../../../services/api'
import toast from 'react-hot-toast'

export default function AudioPanel({ storyId, clip, onUpdate, onTranscribed }) {
  const [volume, setVolume] = useState(clip.volume)
  const [jobId, setJobId] = useState(null)
  const styleJson = clip.style_json || {}
  const [fadeIn, setFadeIn] = useState(styleJson.fade_in_sec ?? 0)
  const [fadeOut, setFadeOut] = useState(styleJson.fade_out_sec ?? 0)

  useEffect(() => { setVolume(clip.volume) }, [clip.id, clip.volume])
  useEffect(() => {
    setFadeIn(styleJson.fade_in_sec ?? 0)
    setFadeOut(styleJson.fade_out_sec ?? 0)
  }, [clip.id, clip.style_json])
  useEffect(() => { setJobId(null) }, [clip.id])

  const startTranscribe = useMutation({
    mutationFn: () => api.post(`/api/content/stories/${storyId}/transcribe`, { clip_id: clip.id }),
    onSuccess: (r) => { setJobId(r.data.id); toast('Transcribing…', { icon: '🎙️' }) },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to start transcription'),
  })

  const { data: job } = useQuery({
    queryKey: ['transcribe-job', storyId, jobId],
    queryFn: () => api.get(`/api/content/stories/${storyId}/transcribe/${jobId}`).then(r => r.data),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'pending' || status === 'processing' ? 3000 : false
    },
  })

  useEffect(() => {
    if (job?.status === 'completed') {
      toast.success('Transcription complete — captions added')
      onTranscribed?.()
      setJobId(null)
    } else if (job?.status === 'failed') {
      toast.error(job.error_message || 'Transcription failed')
      setJobId(null)
    }
  }, [job?.status])

  const transcribing = job && (job.status === 'pending' || job.status === 'processing')
  const maxFade = Math.max((clip.timeline_end_sec - clip.timeline_start_sec) / 2, 0.1)

  function commitFade(key, value) {
    onUpdate({ style_json: { ...styleJson, [key]: value } })
  }

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Volume</label>
        <input
          type="range" min={0} max={1} step={0.05}
          value={volume}
          onChange={e => setVolume(Number(e.target.value))}
          onMouseUp={() => onUpdate({ volume })}
          onTouchEnd={() => onUpdate({ volume })}
          className="w-full accent-primary-600"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Fade in ({fadeIn.toFixed(1)}s)</label>
        <input
          type="range" min={0} max={maxFade} step={0.1}
          value={fadeIn}
          onChange={e => setFadeIn(Number(e.target.value))}
          onMouseUp={() => commitFade('fade_in_sec', fadeIn)}
          onTouchEnd={() => commitFade('fade_in_sec', fadeIn)}
          className="w-full accent-primary-600"
        />
      </div>

      <div>
        <label className="block text-xs font-medium text-gray-500 mb-1">Fade out ({fadeOut.toFixed(1)}s)</label>
        <input
          type="range" min={0} max={maxFade} step={0.1}
          value={fadeOut}
          onChange={e => setFadeOut(Number(e.target.value))}
          onMouseUp={() => commitFade('fade_out_sec', fadeOut)}
          onTouchEnd={() => commitFade('fade_out_sec', fadeOut)}
          className="w-full accent-primary-600"
        />
      </div>

      <div className="pt-1 border-t border-gray-100">
        <button
          onClick={() => startTranscribe.mutate()}
          disabled={startTranscribe.isPending || transcribing}
          className="text-xs font-medium text-primary-600 hover:text-primary-700 border border-primary-200 hover:border-primary-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        >
          {transcribing ? `Transcribing… (${job.status})` : '🎙️ Auto-transcribe captions'}
        </button>
      </div>
    </div>
  )
}
