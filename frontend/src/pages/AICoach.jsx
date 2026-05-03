import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import api from '../services/api'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'

export default function AICoach() {
  const [params] = useSearchParams()
  const [sessionId, setSessionId] = useState(null)
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [model, setModel] = useState('gpt-4o')
  const bottomRef = useRef(null)

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: () => api.get('/api/goals').then(r => r.data),
  })

  useEffect(() => {
    // Auto-create session
    const goalId = goals.find(g => g.status === 'active')?.id
    api.post('/api/ai-coach/sessions', { goal_id: goalId })
      .then(r => {
        setSessionId(r.data.id)
        // Pre-seed with day context if coming from dashboard
        const date = params.get('date')
        const dayType = params.get('day_type')
        if (date && dayType) {
          setInput(`I need help with my ${dayType} session on ${date}. Can you help me adjust or explain it?`)
        }
      })
  }, [goals.length])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function sendMessage() {
    if (!input.trim() || !sessionId || streaming) return
    const text = input.trim()
    setInput('')
    setMessages(m => [...m, { role: 'user', content: text }])
    setStreaming(true)

    try {
      const resp = await fetch(`/api/ai-coach/sessions/${sessionId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify({ message: text, model }),
      })

      let assistantText = ''
      setMessages(m => [...m, { role: 'assistant', content: '' }])

      const reader = resp.body.getReader()
      const decoder = new TextDecoder()
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        const chunk = decoder.decode(value)
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (data === '[DONE]') break
          try {
            const { token, error } = JSON.parse(data)
            if (error) { toast.error(error); break }
            if (token) {
              assistantText += token
              setMessages(m => {
                const copy = [...m]
                copy[copy.length - 1] = { role: 'assistant', content: assistantText }
                return copy
              })
            }
          } catch {}
        }
      }
    } catch {
      toast.error('Connection error. Please try again.')
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-nav">
      {/* Header */}
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold">AI Coach</h1>
          <p className="text-primary-200 text-sm">Powered by GitHub Copilot</p>
        </div>
        <select value={model} onChange={e => setModel(e.target.value)}
          className="bg-primary-700 text-white text-xs rounded-lg px-2 py-1 border border-primary-500">
          <option value="gpt-4o">GPT-4o</option>
          <option value="gpt-4.1">GPT-4.1</option>
          <option value="claude-sonnet-4.6">Claude Sonnet</option>
        </select>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="text-5xl mb-3">🤖</div>
            <p className="text-gray-600 font-medium">Your AI Training Coach</p>
            <p className="text-gray-400 text-sm mt-1">Ask me to adjust your plan, explain workouts, or give nutrition advice.</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            {m.role === 'assistant' && <span className="text-xl mr-2 self-end">🤖</span>}
            <div className={`max-w-[85%] px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
              m.role === 'user'
                ? 'bg-primary-600 text-white rounded-br-sm'
                : 'bg-white text-gray-900 border border-gray-200 rounded-bl-sm'
            }`}>
              {m.content || (streaming && i === messages.length - 1 ? <span className="animate-pulse">▊</span> : '')}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-200 px-4 py-3 safe-bottom">
        <div className="flex gap-2 items-end max-w-lg mx-auto">
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
            placeholder="Ask your coach anything..."
            rows={1}
            className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
          />
          <button
            onClick={sendMessage}
            disabled={!input.trim() || streaming || !sessionId}
            className="bg-primary-600 text-white p-2.5 rounded-xl active:bg-primary-700 disabled:opacity-40"
          >
            {streaming ? '⏳' : '➤'}
          </button>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
