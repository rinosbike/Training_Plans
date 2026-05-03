import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'

function SportBadge({ sport }) {
  const map = {
    run: { label: 'Run', bg: 'bg-green-100 text-green-700' },
    cycle: { label: 'Ride', bg: 'bg-indigo-100 text-indigo-700' },
    swim: { label: 'Swim', bg: 'bg-cyan-100 text-cyan-700' },
    strength: { label: 'Strength', bg: 'bg-purple-100 text-purple-700' },
    core: { label: 'Core', bg: 'bg-pink-100 text-pink-700' },
  }
  const s = map[sport] || { label: sport, bg: 'bg-gray-100 text-gray-600' }
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s.bg}`}>{s.label}</span>
}

function fmt(min) {
  if (!min) return '—'
  const h = Math.floor(min / 60)
  const m = Math.round(min % 60)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}

export default function Sync() {
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState({})

  const { data: status, isLoading } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.get('/api/sync/status').then(r => r.data),
    refetchInterval: 10000,
  })

  const disconnect = useMutation({
    mutationFn: (provider) => api.post('/api/sync/disconnect', { provider }),
    onSuccess: (_, provider) => {
      qc.invalidateQueries(['sync-status'])
      toast.success(`Disconnected from ${provider}`)
    },
  })

  async function syncNow(provider) {
    setSyncing(s => ({ ...s, [provider]: true }))
    try {
      const { data } = await api.post(`/api/sync/${provider}/run`)
      qc.invalidateQueries(['sync-status'])
      toast.success(`Imported ${data.imported} new activities from ${provider}`)
    } catch (e) {
      toast.error(e.response?.data?.error || `${provider} sync failed`)
    } finally {
      setSyncing(s => ({ ...s, [provider]: false }))
    }
  }

  // Build connect URL with JWT state so callback can identify user
  function connectUrl(provider) {
    const token = localStorage.getItem('access_token') || ''
    return `/api/sync/${provider}/connect?state=${encodeURIComponent(token)}`
  }

  const providers = [
    {
      id: 'strava',
      label: 'Strava',
      icon: '🚀',
      color: 'text-orange-600',
      desc: 'Import all activities — including those auto-synced from your Suunto watch.',
      setup: [
        'Go to strava.com/settings/api',
        'Create an app → copy Client ID and Client Secret',
        'Add to server .env: STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=...',
        'Restart the service, then click Connect below',
      ],
      note: 'Free. Suunto → Strava auto-sync means this covers your watch data immediately.',
    },
    {
      id: 'suunto',
      label: 'Suunto Direct',
      icon: '⌚',
      color: 'text-blue-600',
      desc: 'Direct API access — richer data: R-R intervals, Peak Training Effect, recovery time.',
      setup: [
        'Apply at apizone.suunto.com (requires organization account)',
        'Once approved, get Client ID, Client Secret, Subscription Key',
        'Add to .env: SUUNTO_CLIENT_ID=... SUUNTO_CLIENT_SECRET=... SUUNTO_SUBSCRIPTION_KEY=...',
        'Restart the service, then click Connect below',
      ],
      note: 'Adds HRV, Peak TE, recovery hours — not available via Strava. Application may take 1-5 days.',
    },
  ]

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold">Device Sync</h1>
        <p className="text-primary-200 text-sm">Connect Strava or Suunto to import your workouts</p>
      </div>

      <div className="px-4 mt-4 space-y-4">

        {/* Provider cards */}
        {providers.map(p => {
          const conn = status?.connected?.[p.id]
          const isConnected = !!conn
          const lastSync = status?.recent_syncs?.find(s => s.provider === p.id)

          return (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              {/* Header */}
              <div className="px-4 pt-4 pb-3 flex items-start gap-3">
                <span className="text-3xl mt-0.5">{p.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className={`font-semibold text-gray-900`}>{p.label}</h3>
                    {isConnected && (
                      <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">
                        Connected
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">{p.desc}</p>
                  {isConnected && lastSync && (
                    <p className="text-xs text-gray-400 mt-1">
                      Last sync: {new Date(lastSync.synced_at).toLocaleString()} ·{' '}
                      <span className={lastSync.status === 'success' ? 'text-green-600' : 'text-red-500'}>
                        {lastSync.status === 'success' ? `+${lastSync.activities_imported} activities` : lastSync.error_msg || 'error'}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {/* Setup steps (shown when not connected) */}
              {!isConnected && (
                <div className="mx-4 mb-3 bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Setup steps</p>
                  <ol className="space-y-1">
                    {p.setup.map((step, i) => (
                      <li key={i} className="flex gap-2 text-xs text-gray-600">
                        <span className="font-bold text-primary-600 shrink-0">{i+1}.</span>
                        <span>{step}</span>
                      </li>
                    ))}
                  </ol>
                  <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5 mt-2">{p.note}</p>
                </div>
              )}

              {/* Actions */}
              <div className="px-4 pb-4 flex gap-2">
                {isConnected ? (
                  <>
                    <button
                      onClick={() => syncNow(p.id)}
                      disabled={syncing[p.id]}
                      className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium active:bg-primary-700 disabled:opacity-50"
                    >
                      {syncing[p.id] ? 'Syncing...' : 'Sync Now'}
                    </button>
                    <button
                      onClick={() => disconnect.mutate(p.id)}
                      className="px-4 py-2.5 rounded-xl border border-red-300 text-red-600 text-sm font-medium active:bg-red-50"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <a
                    href={connectUrl(p.id)}
                    className="flex-1 block py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium text-center active:bg-primary-700"
                  >
                    Connect {p.label}
                  </a>
                )}
              </div>
            </div>
          )
        })}

        {/* Recent imported activities */}
        {status?.recent_activities?.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Recently Imported</h3>
            <div className="space-y-3">
              {status.recent_activities.map((a, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="pt-0.5">
                    <SportBadge sport={a.source === 'strava' ? '🚀' : '⌚'} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <SportBadge sport={a.sport || 'run'} />
                      <span className="text-xs text-gray-500">{a.log_date}</span>
                      <span className="text-xs font-medium text-gray-400 uppercase">{a.source}</span>
                    </div>
                    <div className="flex gap-3 mt-1 text-xs text-gray-600">
                      <span>{fmt(a.actual_duration_min)}</span>
                      {a.actual_distance_km && <span>{a.actual_distance_km} km</span>}
                      {a.avg_hr && <span>♥ {a.avg_hr} bpm</span>}
                      {a.calories_burned && <span>{a.calories_burned} kcal</span>}
                    </div>
                    {a.notes && <p className="text-xs text-gray-400 truncate mt-0.5">{a.notes}</p>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* How matching works */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="font-semibold text-gray-900 mb-2">How Auto-Match Works</h3>
          <div className="space-y-2 text-xs text-gray-600">
            <p>When an activity is imported, we look for a planned workout on the same date with the same sport type and duration within ±40%.</p>
            <p>If matched: the planned workout shows as <span className="text-green-600 font-medium">completed ✓</span> on your calendar with your actual stats.</p>
            <p>If no match: the activity is still saved and visible here — useful for unplanned extra sessions.</p>
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
