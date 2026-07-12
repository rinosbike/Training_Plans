import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '../../services/api'
import toast from 'react-hot-toast'

export default function ClipInspector({ storyId, clip, track, onUpdate, onDelete, onTranscribed }) {
  const [text, setText] = useState(clip.text_content || '')
  const [volume, setVolume] = useState(clip.volume)
  const [jobId, setJobId] = useState(null)

  useEffect(() => { setText(clip.text_content || '') }, [clip.id, clip.text_content])
  useEffect(() => { setVolume(clip.volume) }, [clip.id, clip.volume])
  useEffect(() => { setJobId(null) }, [clip.id])

  const duration = (clip.timeline_end_sec - clip.timeline_start_sec).toFixed(2)
  const canTranscribe = clip.source_type === 'video' || clip.source_type === 'audio'

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

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {track.name} · {clip.source_type}
        </span>
        <button onClick={onDelete} className="text-gray-300 hover:text-red-500 text-xs">🗑 Delete clip</button>
      </div>

      <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
        <div>Start: <span className="font-mono text-gray-800">{clip.timeline_start_sec.toFixed(2)}s</span></div>
        <div>End: <span className="font-mono text-gray-800">{clip.timeline_end_sec.toFixed(2)}s</span></div>
        <div>Duration: <span className="font-mono text-gray-800">{duration}s</span></div>
        {clip.source_duration_sec != null && (
          <div>Source: <span className="font-mono text-gray-800">{clip.source_duration_sec.toFixed(2)}s</span></div>
        )}
      </div>

      {clip.source_type === 'text' && (
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Caption text</label>
          <textarea
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
            rows={2}
            value={text}
            onChange={e => setText(e.target.value)}
            onBlur={() => text !== (clip.text_content || '') && onUpdate({ text_content: text })}
          />
        </div>
      )}

      {(clip.source_type === 'video' || clip.source_type === 'audio') && (
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
      )}

      {canTranscribe && (
        <div className="pt-1 border-t border-gray-100">
          <button
            onClick={() => startTranscribe.mutate()}
            disabled={startTranscribe.isPending || transcribing}
            className="text-xs font-medium text-primary-600 hover:text-primary-700 border border-primary-200 hover:border-primary-400 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
          >
            {transcribing ? `Transcribing… (${job.status})` : '🎙️ Auto-transcribe captions'}
          </button>
        </div>
      )}
    </div>
  )
}
