import { useState, useRef, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'

function SessionPanel({ sessions, activeId, onSelect, onNew, t }) {
  return (
    <div className="absolute inset-0 z-20 bg-white flex flex-col">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4 flex items-center gap-3">
        <button onClick={onNew} className="text-primary-200 text-sm underline">{t('newChat')}</button>
        <h2 className="text-lg font-bold flex-1 text-center">{t('history')}</h2>
        <div className="w-16" />
      </div>
      <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
        {sessions.length === 0 && (
          <p className="text-center text-gray-400 py-12 text-sm">{t('noSessions')}</p>
        )}
        {sessions.map(s => (
          <button
            key={s.id}
            onClick={() => onSelect(s.id)}
            className={`w-full text-left px-4 py-3 hover:bg-gray-50 active:bg-gray-100 ${
              s.id === activeId ? 'bg-primary-50 border-l-4 border-primary-500' : ''
            }`}
          >
            <p className="font-medium text-gray-900 text-sm truncate">
              {s.title || t('untitledSession')}
            </p>
            <p className="text-xs text-gray-400 mt-0.5">
              {s.updated_at ? new Date(s.updated_at).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
              }) : ''}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}

function FoodLoggedCard({ items, t }) {
  if (!items || items.length === 0) return null
  const newItems = items.filter(i => !i.action)
  const editItems = items.filter(i => i.action)
  const totalCal = newItems.reduce((s, i) => s + (i.calories || 0), 0)
  return (
    <div className="mx-4 my-2 bg-green-50 border border-green-200 rounded-xl px-4 py-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-green-600 text-lg">✓</span>
        <span className="text-green-800 font-semibold text-sm">{t('foodLogged')}</span>
        {totalCal > 0 && <span className="ml-auto text-green-700 text-xs font-medium">{totalCal} kcal</span>}
      </div>
      <ul className="space-y-0.5">
        {newItems.map((item, i) => (
          <li key={`new-${i}`} className="text-xs text-green-700 flex justify-between">
            <span>{item.name} – {item.amount_g}g ({item.meal_type})</span>
            {item.unknown && <span className="text-orange-500 ml-1">?</span>}
          </li>
        ))}
        {editItems.map((item, i) => (
          <li key={`edit-${i}`} className={`text-xs flex justify-between ${item.notFound ? 'text-orange-600' : item.action === 'deleted' ? 'text-red-600 line-through' : 'text-blue-700'}`}>
            <span>
              {item.action === 'deleted' ? '🗑 ' : item.action === 'updated' ? '✏ ' : '? '}
              {item.name}
              {item.action === 'updated' && item.amount_g ? ` → ${item.amount_g}g` : ''}
              {item.notFound ? ' (not found)' : ''}
            </span>
            {item.calories > 0 && <span>{item.calories} kcal</span>}
          </li>
        ))}
      </ul>
    </div>
  )
}

const NUTRIENT_LABELS = {
  calories_per_100g: 'Energy', protein_per_100g: 'Protein', carbs_per_100g: 'Carbs',
  fat_per_100g: 'Fat', fiber_per_100g: 'Fibre', sodium_per_100g: 'Sodium',
  iron_per_100g: 'Iron', calcium_per_100g: 'Calcium', vitamin_d_per_100g: 'Vit D',
  vitamin_b12_per_100g: 'Vit B12', vitamin_c_per_100g: 'Vit C',
  magnesium_per_100g: 'Magnesium', potassium_per_100g: 'Potassium', zinc_per_100g: 'Zinc',
}
const NUTRIENT_UNITS = {
  calories_per_100g: 'kcal', protein_per_100g: 'g', carbs_per_100g: 'g',
  fat_per_100g: 'g', fiber_per_100g: 'g', sodium_per_100g: 'mg',
  iron_per_100g: 'mg', calcium_per_100g: 'mg', vitamin_d_per_100g: 'mcg',
  vitamin_b12_per_100g: 'mcg', vitamin_c_per_100g: 'mg',
  magnesium_per_100g: 'mg', potassium_per_100g: 'mg', zinc_per_100g: 'mg',
}

function fmt2(v) {
  const n = Number(v)
  return n < 10 ? n.toFixed(1) : Math.round(n).toString()
}

function ProposedActionsCard({ actions, onApply, onDismiss, appliedIds, t }) {
  if (!actions || actions.length === 0) return null
  return (
    <div className="mx-4 my-2 space-y-2">
      {actions.map((action, i) => {
        const key = `${action.type}-${action.date || action.food_id}-${i}`
        const applied = appliedIds.has(key)
        const isDbFix = action.type === 'update_food_db'
        return (
          <div key={key} className={`bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 ${applied ? 'opacity-60' : ''}`}>
            <div className="flex items-start gap-2">
              <span className="text-amber-500 text-lg mt-0.5">{isDbFix ? '🏷' : '⚡'}</span>
              <div className="flex-1">
                <p className="text-amber-900 font-semibold text-sm">
                  {isDbFix ? t('proposedDbFix') : t('proposedChange')}
                </p>
                <p className="text-amber-800 text-xs mt-0.5">{action.description}</p>
                {action.date && !isDbFix && (
                  <p className="text-amber-600 text-xs mt-0.5">
                    {new Date(action.date + 'T12:00:00').toLocaleDateString(undefined, {
                      weekday: 'short', month: 'short', day: 'numeric'
                    })}
                    {action.workout_title ? ` — ${action.workout_title}` : ''}
                  </p>
                )}
                {/* Old → new diff table for DB corrections */}
                {isDbFix && action.diff && (
                  <table className="mt-2 w-full text-xs">
                    <thead>
                      <tr className="text-amber-600 border-b border-amber-200">
                        <th className="text-left pb-1 font-semibold">Nutrient</th>
                        <th className="text-right pb-1 pr-3 font-semibold">Was</th>
                        <th className="text-right pb-1 font-semibold">Label</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(action.diff).map(([col, { old: o, new: n }]) => (
                        <tr key={col} className="border-t border-amber-100">
                          <td className="py-0.5 text-amber-800">{NUTRIENT_LABELS[col] || col}</td>
                          <td className="py-0.5 pr-3 text-right text-amber-600 tabular-nums line-through">{fmt2(o)} {NUTRIENT_UNITS[col]}</td>
                          <td className="py-0.5 text-right text-green-700 font-semibold tabular-nums">{fmt2(n)} {NUTRIENT_UNITS[col]}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
                {isDbFix && (
                  <p className="text-amber-600 text-[10px] mt-1.5 italic">
                    {t('dbFixNote')}
                  </p>
                )}
              </div>
            </div>
            {!applied && (
              <div className="flex gap-2 mt-2">
                <button
                  onClick={() => onApply(action, key)}
                  className="flex-1 bg-amber-500 text-white text-xs font-semibold py-1.5 rounded-lg active:bg-amber-600"
                >
                  {t('apply')} ✓
                </button>
                <button
                  onClick={() => onDismiss(key)}
                  className="flex-1 bg-white border border-amber-300 text-amber-700 text-xs font-semibold py-1.5 rounded-lg active:bg-amber-50"
                >
                  {t('dismiss')} ✗
                </button>
              </div>
            )}
            {applied && (
              <p className="text-xs text-green-600 mt-1 font-medium">✓ {t('applied')}</p>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function AICoach() {
  const [params] = useSearchParams()
  const { t } = useTranslation('ai_coach')
  const qc = useQueryClient()

  const [sessionId, setSessionId] = useState(null)
  const [messages, setMessages] = useState([])   // {role, content, foodLogged?, proposedActions?, ts?}
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [showHistory, setShowHistory] = useState(false)
  const [appliedIds, setAppliedIds] = useState(new Set())
  const [scanning, setScanning] = useState(false)
  const [attachment, setAttachment] = useState(null) // {name, preview}
  const fileRef = useRef(null)
  const bottomRef = useRef(null)

  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: () => api.get('/api/goals').then(r => r.data),
  })

  const { data: sessions = [], refetch: refetchSessions, isSuccess: sessionsLoaded } = useQuery({
    queryKey: ['ai-sessions'],
    queryFn: () => api.get('/api/ai-coach/sessions').then(r => r.data),
  })

  const initialized = useRef(false)

  // Load most recent session (or create one) — runs once when sessions query settles
  useEffect(() => {
    if (!sessionsLoaded || initialized.current) return
    initialized.current = true

    async function init() {
      if (sessions.length > 0) {
        await loadSession(sessions[0].id)
      } else {
        await createNewSession()
      }
      const date = params.get('date')
      const dayType = params.get('day_type')
      if (date && dayType) {
        setInput(t('dayPrompt', { dayType, date }))
      }
    }
    init()
  }, [sessionsLoaded])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  async function createNewSession() {
    const goalId = goals.find(g => g.status === 'active')?.id
    const r = await api.post('/api/ai-coach/sessions', { goal_id: goalId })
    setSessionId(r.data.id)
    setMessages([])
    refetchSessions()
    return r.data.id
  }

  async function loadSession(id) {
    setSessionId(id)
    setShowHistory(false)
    const r = await api.get(`/api/ai-coach/sessions/${id}/messages`)
    const loaded = r.data.map(m => ({
      role: m.role,
      content: m.content,
      ts: m.created_at,
    }))
    setMessages(loaded)
  }

  async function handleSelectSession(id) {
    await loadSession(id)
  }

  async function handleNewChat() {
    const newId = await createNewSession()
    setShowHistory(false)
  }

  async function applyAction(action, key) {
    try {
      await api.post(`/api/ai-coach/sessions/${sessionId}/apply-action`, { action })
      setAppliedIds(prev => new Set([...prev, key]))
      toast.success(t('applied'))
      qc.invalidateQueries(['plan-days'])
    } catch {
      toast.error(t('applyError'))
    }
  }

  function dismissAction(key) {
    setAppliedIds(prev => new Set([...prev, key]))
  }

  async function handleAttachment(e) {
    const file = e.target.files[0]
    e.target.value = ''
    if (!file) return
    if (file.size > 8 * 1024 * 1024) { toast.error('Image must be under 8 MB'); return }

    setScanning(true)
    setAttachment({ name: file.name })
    try {
      const fd = new FormData()
      fd.append('image', file)
      const { data } = await api.post('/api/ocr/food-label', fd)
      const p = data.per_100g || {}
      const parts = [`Food label scanned: "${data.food_name_guess || 'Unknown food'}".`]
      parts.push(`Per 100g — Energy: ${p.calories_per_100g ?? '?'} kcal, Protein: ${p.protein_per_100g ?? '?'}g, Carbs: ${p.carbs_per_100g ?? '?'}g, Fat: ${p.fat_per_100g ?? '?'}g${p.fiber_per_100g != null ? `, Fibre: ${p.fiber_per_100g}g` : ''}.`)
      if (data.warnings?.length) parts.push(`Note: ${data.warnings.join('; ')}`)
      parts.push('Please log this for me and save these values to the database.')
      setInput(parts.join(' '))
    } catch (err) {
      toast.error(err.response?.data?.error || 'OCR failed — try a clearer photo')
      setAttachment(null)
    } finally {
      setScanning(false)
    }
  }

  async function sendMessage() {
    if (!input.trim() || !sessionId || streaming) return
    setAttachment(null)
    const text = input.trim()
    setInput('')
    const now = new Date().toISOString()
    setMessages(m => [...m, { role: 'user', content: text, ts: now }])
    setStreaming(true)

    try {
      const resp = await fetch(`/api/ai-coach/sessions/${sessionId}/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify({
          message: text,
          client_date: new Date().toLocaleDateString('en-CA'), // YYYY-MM-DD in user's local timezone
        }),
      })

      let assistantText = ''
      let foodLogged = null
      let proposedActions = null
      setMessages(m => [...m, { role: 'assistant', content: '', ts: new Date().toISOString() }])

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
            const parsed = JSON.parse(data)
            if (parsed.error) { toast.error(parsed.error); break }
            if (parsed.token) {
              assistantText += parsed.token
              setMessages(m => {
                const copy = [...m]
                copy[copy.length - 1] = { ...copy[copy.length - 1], content: assistantText }
                return copy
              })
            }
            if (parsed.food_logged) foodLogged = parsed.food_logged
            if (parsed.proposed_actions) proposedActions = parsed.proposed_actions
          } catch {}
        }
      }

      // Attach food/plan cards to the assistant message
      if (foodLogged || proposedActions) {
        setMessages(m => {
          const copy = [...m]
          copy[copy.length - 1] = {
            ...copy[copy.length - 1],
            foodLogged: foodLogged || [],
            proposedActions: proposedActions || [],
          }
          return copy
        })
        if (foodLogged?.length) qc.invalidateQueries(['food-log'])
      }
      refetchSessions()
    } catch {
      toast.error(t('connectionError'))
    } finally {
      setStreaming(false)
    }
  }

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 pb-nav relative">
      {/* Header */}
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4 flex items-center gap-3">
        <button
          onClick={() => setShowHistory(true)}
          className="p-1.5 rounded-lg bg-primary-700 active:bg-primary-800"
          aria-label={t('history')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        </button>
        <div className="flex-1">
          <h1 className="text-lg font-bold leading-none">{t('title')}</h1>
          <p className="text-primary-200 text-xs mt-0.5">{t('subtitle')}</p>
        </div>
        <button
          onClick={handleNewChat}
          className="p-1.5 rounded-lg bg-primary-700 active:bg-primary-800"
          aria-label={t('newChat')}
        >
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 4v16m8-8H4" />
          </svg>
        </button>
      </div>

      {/* History panel */}
      {showHistory && (
        <div className="absolute inset-0 z-20 bg-white flex flex-col" style={{ top: 0 }}>
          <div className="bg-primary-600 text-white px-4 pt-12 pb-4 flex items-center gap-3">
            <button
              onClick={() => setShowHistory(false)}
              className="p-1.5 rounded-lg bg-primary-700 active:bg-primary-800"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <h2 className="flex-1 text-lg font-bold">{t('history')}</h2>
            <button
              onClick={handleNewChat}
              className="text-primary-200 text-sm font-medium"
            >{t('newChat')}</button>
          </div>
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {sessions.length === 0 && (
              <p className="text-center text-gray-400 py-12 text-sm">{t('noSessions')}</p>
            )}
            {sessions.map(s => (
              <button
                key={s.id}
                onClick={() => handleSelectSession(s.id)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-50 active:bg-gray-100 ${
                  s.id === sessionId ? 'bg-primary-50 border-l-4 border-primary-500' : ''
                }`}
              >
                <p className="font-medium text-gray-900 text-sm truncate">
                  {s.title || t('untitledSession')}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">
                  {s.updated_at ? new Date(s.updated_at).toLocaleDateString(undefined, {
                    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
                  }) : ''}
                </p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-1">
        {messages.length === 0 && (
          <div className="text-center py-12">
            <div className="text-5xl mb-3">🤖</div>
            <p className="text-gray-600 font-medium">{t('empty')}</p>
            <p className="text-gray-400 text-sm mt-1">{t('emptyDesc')}</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i}>
            <div className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'} mb-1`}>
              {m.role === 'assistant' && <span className="text-xl mr-2 self-end">🤖</span>}
              <div className="flex flex-col items-end max-w-[85%]">
                <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap ${
                  m.role === 'user'
                    ? 'bg-primary-600 text-white rounded-br-sm'
                    : 'bg-white text-gray-900 border border-gray-200 rounded-bl-sm'
                }`}>
                  {m.content || (streaming && i === messages.length - 1
                    ? <span className="animate-pulse">▊</span>
                    : '')}
                </div>
                {m.ts && (
                  <span className="text-xs text-gray-400 mt-0.5 px-1">
                    {new Date(m.ts).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>
            </div>
            {m.foodLogged?.length > 0 && (
              <FoodLoggedCard items={m.foodLogged} t={t} />
            )}
            {m.proposedActions?.length > 0 && (
              <ProposedActionsCard
                actions={m.proposedActions}
                onApply={applyAction}
                onDismiss={dismissAction}
                appliedIds={appliedIds}
                t={t}
              />
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="bg-white border-t border-gray-200 px-4 py-3 safe-bottom">
        <div className="max-w-lg mx-auto">
          {attachment && (
            <div className="flex items-center gap-2 mb-1.5 px-1">
              <span className="text-xs text-primary-600 font-medium truncate">📎 {attachment.name}</span>
              <button onClick={() => setAttachment(null)} className="text-gray-400 text-xs hover:text-gray-600">✕</button>
            </div>
          )}
          <div className="flex gap-2 items-end">
            <button
              onClick={() => fileRef.current?.click()}
              disabled={scanning || streaming}
              className="p-2.5 rounded-xl border border-gray-200 text-gray-500 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-40 shrink-0"
              title="Scan food label"
            >
              {scanning
                ? <span className="animate-spin inline-block w-5 h-5 border-2 border-gray-300 border-t-primary-600 rounded-full" />
                : <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
                  </svg>
              }
            </button>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={handleAttachment}
            />
            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() } }}
              placeholder={t('placeholder')}
              rows={1}
              className="flex-1 border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 resize-none"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || streaming || !sessionId}
              className="bg-primary-600 text-white p-2.5 rounded-xl active:bg-primary-700 disabled:opacity-40 shrink-0"
            >
              {streaming ? '⏳' : '➤'}
            </button>
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
