import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '../../../services/api'
import toast from 'react-hot-toast'
import FilterSliders from './FilterSliders'

const SPEED_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 2]

export default function VideoPanel({ storyId, clip, onUpdate, onTranscribed }) {
  const [volume, setVolume] = useState(clip.volume)
  const [jobId, setJobId] = useState(null)

  useEffect(() => { setVolume(clip.volume) }, [clip.id, clip.volume])
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
  const styleJson = clip.style_json || {}

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
        <label className="block text-xs font-medium text-gray-500 mb-1">Speed</label>
        <div className="flex flex-wrap gap-1.5">
          {SPEED_OPTIONS.map(s => (
            <button
              key={s}
              onClick={() => onUpdate({ speed: s })}
              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                clip.speed === s
                  ? 'bg-primary-600 text-white border-primary-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      <FilterSliders styleJson={styleJson} onUpdate={onUpdate} />

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
