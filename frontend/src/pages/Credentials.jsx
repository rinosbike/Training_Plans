import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'

const PLATFORM_ICONS = { strava: '🚀', suunto: '⌚' }

function KeyField({ keyDef, platformId, savedValue, onSave }) {
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')

  function submit() {
    if (!val.trim()) return
    onSave(keyDef.name, val.trim())
    setVal('')
    setEditing(false)
  }

  return (
    <div className="flex items-center gap-3 py-2 border-b border-gray-100 last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-sm font-medium text-gray-800">{keyDef.label}</p>
        <p className="text-xs text-gray-400 font-mono">
          {keyDef.saved ? (keyDef.is_secret ? '••••••••' : '(saved)') : 'not set'}
        </p>
        {keyDef.updated_at && (
          <p className="text-xs text-gray-300">Updated {new Date(keyDef.updated_at).toLocaleDateString()}</p>
        )}
      </div>
      {editing ? (
        <div className="flex gap-2 flex-1">
          <input
            autoFocus
            type={keyDef.is_secret ? 'password' : 'text'}
            value={val}
            onChange={e => setVal(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder={keyDef.label}
            className="flex-1 border border-gray-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-primary-500"
          />
          <button onClick={submit} className="px-3 py-1.5 bg-primary-600 text-white text-sm rounded-lg">Save</button>
          <button onClick={() => { setEditing(false); setVal('') }} className="px-3 py-1.5 border border-gray-300 text-gray-600 text-sm rounded-lg">✕</button>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="text-xs px-3 py-1.5 rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
        >
          {keyDef.saved ? 'Update' : 'Set'}
        </button>
      )}
    </div>
  )
}

function PlatformCard({ platform }) {
  const qc = useQueryClient()
  const [testResult, setTestResult] = useState(null)
  const [testing, setTesting] = useState(false)

  const save = useMutation({
    mutationFn: ({ key_name, value }) =>
      api.put(`/api/credentials/${platform.platform}`, { [key_name]: value }),
    onSuccess: () => {
      qc.invalidateQueries(['credentials'])
      toast.success('Credential saved')
    },
    onError: () => toast.error('Failed to save'),
  })

  async function testConnection() {
    setTesting(true)
    setTestResult(null)
    try {
      const { data } = await api.post(`/api/credentials/test/${platform.platform}`)
      setTestResult({ ok: true, message: data.message })
    } catch (e) {
      setTestResult({ ok: false, message: e.response?.data?.message || 'Connection test failed' })
    } finally {
      setTesting(false)
    }
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-4 pt-4 pb-3 flex items-center gap-3">
        <span className="text-3xl">{PLATFORM_ICONS[platform.platform] || '🔑'}</span>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">{platform.label}</h3>
          <a href={platform.docs} target="_blank" rel="noopener noreferrer" className="text-xs text-primary-600 underline">
            {platform.docs}
          </a>
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
          platform.keys.every(k => k.saved) ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
        }`}>
          {platform.keys.every(k => k.saved) ? 'Configured' : 'Incomplete'}
        </span>
      </div>

      <div className="px-4 pb-2">
        {platform.keys.map(k => (
          <KeyField
            key={k.name}
            keyDef={k}
            platformId={platform.platform}
            onSave={(key_name, value) => save.mutate({ key_name, value })}
          />
        ))}
      </div>

      <div className="px-4 pb-4 pt-2">
        <button
          onClick={testConnection}
          disabled={testing}
          className="w-full py-2.5 rounded-xl border border-primary-300 text-primary-600 text-sm font-medium active:bg-primary-50 disabled:opacity-50"
        >
          {testing ? 'Testing...' : 'Test Configuration'}
        </button>
        {testResult && (
          <div className={`mt-2 rounded-xl px-3 py-2 text-sm ${testResult.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
            {testResult.ok ? '✓ ' : '✗ '}{testResult.message}
          </div>
        )}
      </div>
    </div>
  )
}

export default function Credentials() {
  const { data: platforms, isLoading } = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get('/api/credentials/platforms').then(r => r.data),
  })

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold">API Credentials</h1>
        <p className="text-primary-200 text-sm">Manage third-party integration keys</p>
      </div>

      <div className="px-4 mt-4 space-y-4">
        {isLoading && (
          <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
        )}
        {platforms?.map(p => <PlatformCard key={p.platform} platform={p} />)}

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Security note</p>
          <p>Credentials are stored in the database. Secret values are never returned to the browser — only a masked placeholder is shown after saving.</p>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
