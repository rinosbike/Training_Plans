import { useState, useEffect } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '../../services/api'
import toast from 'react-hot-toast'

export default function VoiceoverPanel({ storyId, tracks, onGenerated }) {
  const audioTracks = tracks.filter(t => t.kind === 'audio')
  const [trackId, setTrackId] = useState(audioTracks[0]?.id || '')
  const [text, setText] = useState('')
  const [jobId, setJobId] = useState(null)

  useEffect(() => {
    if ((!trackId || !audioTracks.some(t => t.id === trackId)) && audioTracks[0]) {
      setTrackId(audioTracks[0].id)
    }
  }, [audioTracks, trackId])

  const startVoiceover = useMutation({
    mutationFn: () => api.post(`/api/content/stories/${storyId}/voiceover`, { track_id: trackId, text_content: text }),
    onSuccess: (r) => { setJobId(r.data.id); toast('Generating voiceover…', { icon: '🗣️' }) },
    onError: (e) => toast.error(e.response?.data?.error || 'Failed to start voiceover'),
  })

  const { data: job } = useQuery({
    queryKey: ['voiceover-job', storyId, jobId],
    queryFn: () => api.get(`/api/content/stories/${storyId}/voiceover/${jobId}`).then(r => r.data),
    enabled: !!jobId,
    refetchInterval: (query) => {
      const status = query.state.data?.status
      return status === 'pending' || status === 'processing' ? 3000 : false
    },
  })

  useEffect(() => {
    if (job?.status === 'completed') {
      toast.success('Voiceover generated')
      onGenerated?.()
      setJobId(null)
      setText('')
    } else if (job?.status === 'failed') {
      toast.error(job.error_message || 'Voiceover generation failed')
      setJobId(null)
    }
  }, [job?.status])

  const generating = job && (job.status === 'pending' || job.status === 'processing')

  if (audioTracks.length === 0) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">🗣️ AI Voiceover</span>
        <p className="text-xs text-gray-400 mt-2">Add an audio track above to generate an AI voiceover.</p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">🗣️ AI Voiceover</span>
        <select
          value={trackId}
          onChange={e => setTrackId(e.target.value)}
          className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white text-gray-700"
        >
          {audioTracks.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        rows={2}
        placeholder="Type narration text…"
        className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
      <button
        onClick={() => startVoiceover.mutate()}
        disabled={!text.trim() || startVoiceover.isPending || generating}
        className="text-xs font-medium text-white bg-primary-600 hover:bg-primary-700 disabled:opacity-50 px-3 py-1.5 rounded-lg transition-colors"
      >
        {generating ? `Generating… (${job.status})` : 'Generate voiceover'}
      </button>
    </div>
  )
}
