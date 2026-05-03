import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'

export default function Sync() {
  const qc = useQueryClient()
  const { data: status } = useQuery({
    queryKey: ['sync-status'],
    queryFn: () => api.get('/api/sync/status').then(r => r.data),
  })
  const disconnect = useMutation({
    mutationFn: (provider) => api.post('/api/sync/disconnect', { provider }),
    onSuccess: () => { qc.invalidateQueries(['sync-status']); toast.success('Disconnected') },
  })

  const providers = [
    { id: 'suunto', label: 'Suunto', icon: '⌚', desc: 'Sync Suunto watch workouts automatically', note: 'Requires Suunto developer account (developer.suunto.com)' },
    { id: 'strava', label: 'Strava', icon: '🚀', desc: 'Import activities from Strava', note: 'Requires Strava API app registration' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold">Device Sync</h1>
        <p className="text-primary-200 text-sm">Connect your fitness apps</p>
      </div>

      <div className="px-4 mt-4 space-y-4">
        {providers.map(p => {
          const connected = status?.connected?.[p.id]
          return (
            <div key={p.id} className="bg-white rounded-2xl border border-gray-100 p-4">
              <div className="flex items-center gap-3 mb-2">
                <span className="text-3xl">{p.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-gray-900">{p.label}</h3>
                    {connected && <span className="bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium">Connected</span>}
                  </div>
                  <p className="text-sm text-gray-500">{p.desc}</p>
                </div>
              </div>
              <p className="text-xs text-amber-600 bg-amber-50 rounded-lg px-3 py-2 mb-3">{p.note}</p>
              {connected ? (
                <button onClick={() => disconnect.mutate(p.id)}
                  className="w-full py-2.5 rounded-xl border border-red-300 text-red-600 text-sm font-medium active:bg-red-50">
                  Disconnect
                </button>
              ) : (
                <a href={`/api/sync/${p.id}/connect`}
                  className="block w-full py-2.5 rounded-xl bg-primary-600 text-white text-sm font-medium text-center active:bg-primary-700">
                  Connect {p.label}
                </a>
              )}
            </div>
          )
        })}

        {/* Recent syncs */}
        {status?.recent_syncs?.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <h3 className="font-semibold text-gray-900 mb-3">Recent Syncs</h3>
            <div className="space-y-2">
              {status.recent_syncs.map((s, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span className="capitalize text-gray-700">{s.provider}</span>
                  <span className={`text-xs font-medium ${s.status === 'success' ? 'text-green-600' : 'text-red-500'}`}>
                    {s.status === 'success' ? `+${s.activities_imported} activities` : 'Error'}
                  </span>
                  <span className="text-gray-400 text-xs">{new Date(s.synced_at).toLocaleDateString()}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
