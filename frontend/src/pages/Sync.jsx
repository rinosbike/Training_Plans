import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'

const PROVIDER_EMOJI = { strava: '🚀', suunto: '⌚' }

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
  const { t, i18n } = useTranslation('sync')
  const qc = useQueryClient()
  const [syncing, setSyncing] = useState({})

  const { data: status } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.get('/api/sync/status').then(r => r.data),
    refetchInterval: 10000,
  })

  const { data: icons = {} } = useQuery({
    queryKey: ['platform-icons'],
    queryFn: () => api.get('/api/admin/platform-icons').then(r => r.data),
  })

  const disconnect = useMutation({
    mutationFn: (provider) => api.post('/api/sync/disconnect', { provider }),
    onSuccess: (_, provider) => {
      qc.invalidateQueries(['sync-status'])
      toast.success(t('disconnected', { provider }))
    },
  })

  async function syncNow(provider) {
    setSyncing(s => ({ ...s, [provider]: true }))
    try {
      const { data } = await api.post(`/api/sync/${provider}/run`)
      qc.invalidateQueries(['sync-status'])
      toast.success(t('syncSuccess', { count: data.imported, provider }))
    } catch (e) {
      toast.error(e.response?.data?.error || t('syncFailed', { provider }))
    } finally {
      setSyncing(s => ({ ...s, [provider]: false }))
    }
  }

  async function connectProvider(provider) {
    try {
      const { data } = await api.get(`/api/sync/${provider}/connect`)
      window.location.href = data.url
    } catch (e) {
      toast.error(e.response?.data?.error || `Cannot connect ${provider}`)
    }
  }

  const providers = [
    {
      id: 'strava',
      label: 'Strava',
      desc: t('providers.strava.desc'),
      note: t('providers.strava.note'),
      setup: [
        'Go to strava.com/settings/api',
        'Create an app → copy Client ID and Client Secret',
        'Add to server .env: STRAVA_CLIENT_ID=... STRAVA_CLIENT_SECRET=...',
        'Restart the service, then click Connect below',
      ],
    },
    {
      id: 'suunto',
      label: 'Suunto Direct',
      desc: t('providers.suunto.desc'),
      note: t('providers.suunto.note'),
      setup: [
        'Apply at apizone.suunto.com (requires organization account)',
        'Once approved, get Client ID, Client Secret, Subscription Key',
        'Add to .env: SUUNTO_CLIENT_ID=... SUUNTO_CLIENT_SECRET=... SUUNTO_SUBSCRIPTION_KEY=...',
        'Restart the service, then click Connect below',
      ],
    },
  ]

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <p className="text-primary-200 text-sm">{t('subtitle')}</p>
      </div>

      <div className="px-4 mt-4 space-y-4">

        {/* Provider cards */}
        {providers.map(p => {
          const conn = status?.connected?.[p.id]
          const isConnected = !!conn
          const lastSync = status?.recent_syncs?.find(s => s.provider === p.id)

          return (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
              <div className="px-4 pt-4 pb-3 flex items-start gap-3">
                {icons[p.id]
                  ? <img src={icons[p.id]} alt={p.label} className="w-10 h-10 rounded-xl object-contain bg-white p-1 shadow-sm border border-gray-100" />
                  : <span className="text-3xl mt-0.5">{PROVIDER_EMOJI[p.id]}</span>
                }
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-0.5">
                    <h3 className="font-semibold text-gray-900">{p.label}</h3>
                    {isConnected && (
                      <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">
                        {t('connected', { provider: p.label })}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-gray-500">{p.desc}</p>
                  {isConnected && lastSync && (
                    <p className="text-xs text-gray-400 mt-1">
                      {t('lastSync', { date: new Date(lastSync.synced_at).toLocaleString(i18n.language) })} ·{' '}
                      <span className={lastSync.status === 'success' ? 'text-green-600' : 'text-red-500'}>
                        {lastSync.status === 'success'
                          ? `+${lastSync.activities_imported} activities`
                          : lastSync.error_msg || 'error'}
                      </span>
                    </p>
                  )}
                </div>
              </div>

              {!isConnected && (
                <div className="mx-4 mb-3 bg-gray-50 rounded-xl p-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('setupSteps')}</p>
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

              <div className="px-4 pb-4 flex gap-2">
                {isConnected ? (
                  <>
                    <button
                      onClick={() => syncNow(p.id)}
                      disabled={syncing[p.id]}
                      className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium active:bg-primary-700 disabled:opacity-50"
                    >
                      {syncing[p.id] ? t('syncing') : t('syncNow')}
                    </button>
                    <button
                      onClick={() => disconnect.mutate(p.id)}
                      className="px-4 py-2.5 rounded-xl border border-red-300 text-red-600 text-sm font-medium active:bg-red-50"
                    >
                      Disconnect
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => connectProvider(p.id)}
                    className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium active:bg-primary-700"
                  >
                    {t('connectBtn', { provider: p.label })}
                  </button>
                )}
              </div>
            </div>
          )
        })}

        {/* Recent imported activities */}
        {status?.recent_activities?.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <h3 className="font-semibold text-gray-900 mb-3">{t('recentlyImported')}</h3>
            <div className="space-y-3">
              {status.recent_activities.map((a, i) => (
                <div key={i} className="flex items-start gap-3">
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
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* How matching works */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="font-semibold text-gray-900 mb-2">{t('autoMatch.title')}</h3>
          <div className="space-y-2 text-xs text-gray-600">
            <p>{t('autoMatch.desc1')}</p>
            <p>{t('autoMatch.desc2')}</p>
            <p>{t('autoMatch.desc3')}</p>
          </div>
        </div>
      </div>

      <BottomNav />
    </div>
  )
}
