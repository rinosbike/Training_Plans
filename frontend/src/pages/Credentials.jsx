import { useState, useRef } from 'react'
import { Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'

const PLATFORM_EMOJI = { strava: '🚀', suunto: '⌚' }

function PlatformIcon({ platformId, iconData, isAdmin }) {
  const qc = useQueryClient()
  const inputRef = useRef(null)
  const [uploading, setUploading] = useState(false)

  async function handleFile(e) {
    const file = e.target.files[0]
    if (!file) return
    if (file.size > 153600) { toast.error('Icon must be under 150 KB'); return }
    setUploading(true)
    const fd = new FormData()
    fd.append('icon', file)
    try {
      await api.post(`/api/admin/platform-icon/${platformId}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      qc.invalidateQueries(['platform-icons'])
      toast.success('Icon updated')
    } catch {
      toast.error('Upload failed')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  async function removeIcon() {
    try {
      await api.delete(`/api/admin/platform-icon/${platformId}`)
      qc.invalidateQueries(['platform-icons'])
      toast.success('Icon removed')
    } catch {
      toast.error('Remove failed')
    }
  }

  return (
    <div className="relative flex flex-col items-center gap-1">
      {iconData ? (
        <img src={iconData} alt={platformId} className="w-12 h-12 rounded-xl object-contain bg-white p-1 border border-gray-200 shadow-sm" />
      ) : (
        <span className="text-4xl">{PLATFORM_EMOJI[platformId] || '🔑'}</span>
      )}
      {isAdmin && (
        <div className="flex gap-1 mt-1">
          <button
            onClick={() => inputRef.current?.click()}
            disabled={uploading}
            className="text-xs px-2 py-1 rounded-lg bg-primary-600 text-white font-medium disabled:opacity-50"
          >
            {uploading ? '...' : iconData ? 'Change' : 'Upload'}
          </button>
          {iconData && (
            <button onClick={removeIcon} className="text-xs px-2 py-1 rounded-lg border border-red-300 text-red-500 font-medium">✕</button>
          )}
        </div>
      )}
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  )
}

function KeyField({ keyDef, platformId, onSave }) {
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

function PlatformCard({ platform, iconData, isAdmin }) {
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
      <div className="px-4 pt-4 pb-3 flex items-start gap-3">
        <PlatformIcon platformId={platform.platform} iconData={iconData} isAdmin={isAdmin} />
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
  const { user } = useAuth()

  const { data: platforms, isLoading } = useQuery({
    queryKey: ['credentials'],
    queryFn: () => api.get('/api/credentials/platforms').then(r => r.data),
  })

  const { data: icons = {} } = useQuery({
    queryKey: ['platform-icons'],
    queryFn: () => api.get('/api/admin/platform-icons').then(r => r.data),
  })

  // Non-admin users have no business here
  if (user && !user.is_admin) return <Navigate to="/settings" replace />

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold">API Credentials</h1>
        <p className="text-primary-200 text-sm">Manage third-party integration keys · Admin only</p>
      </div>

      <div className="px-4 mt-4 space-y-4">
        {isLoading && (
          <div className="text-center py-12 text-gray-400 text-sm">Loading...</div>
        )}
        {platforms?.map(p => (
          <PlatformCard key={p.platform} platform={p} iconData={icons[p.platform]} isAdmin={!!user?.is_admin} />
        ))}

        <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-sm text-amber-800">
          <p className="font-semibold mb-1">Security note</p>
          <p>Credentials are stored in the database. Secret values are never returned to the browser — only a masked placeholder is shown after saving.</p>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
