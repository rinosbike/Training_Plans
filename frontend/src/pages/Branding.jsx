import { useQuery } from '@tanstack/react-query'
import api from '../services/api'
import BottomNav from '../components/BottomNav'

const INTEGRATIONS = [
  {
    id: 'strava',
    name: 'Strava',
    icon: '🚀',
    color: 'text-orange-500',
    bg: 'bg-orange-50',
    border: 'border-orange-100',
    description: 'Activity tracking and social fitness platform',
    status: 'Connected via OAuth 2.0',
    capabilities: ['Import runs, rides, swims, strength sessions', 'Auto-match to planned workouts', 'Real-time webhook push on new activity', 'RPE from Suffer Score', 'Heart rate, power, distance, calories'],
    dataFlow: 'Strava → OAuth callback → training.workout_logs → plan match',
    setupUrl: 'https://www.strava.com/settings/api',
    callbackUrl: 'https://training.rinosbike.com/api/sync/strava/callback',
  },
  {
    id: 'suunto',
    name: 'Suunto Direct',
    icon: '⌚',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
    border: 'border-blue-100',
    description: 'Direct access to Suunto Cloud API for richer biometric data',
    status: 'Pending organization account approval',
    capabilities: ['All workout data via Suunto Cloud API', 'R-R intervals (HRV)', 'Peak Training Effect', 'Recovery time estimation', 'Open Water swim data', 'Richer than Strava export'],
    dataFlow: 'Suunto watch → Suunto Cloud → OAuth + Subscription Key → training.workout_logs',
    setupUrl: 'https://apizone.suunto.com',
    callbackUrl: 'https://training.rinosbike.com/api/sync/suunto/callback',
    note: 'Requires organization account. Application sent. Meanwhile, Suunto auto-syncs to Strava.',
  },
]

const TECH_STACK = [
  { label: 'Backend', value: 'Flask (Python 3.11) · Gunicorn · Port 5002' },
  { label: 'Frontend', value: 'React 18 · Vite · Tailwind CSS · Mobile-first' },
  { label: 'Database', value: 'PostgreSQL (NeonDB) · training schema · RLS per user' },
  { label: 'Auth', value: 'Google OAuth2 + Apple ID · JWT (8h access / 30d refresh)' },
  { label: 'AI Coach', value: 'GitHub Copilot API · SSE streaming · GPT-4o' },
  { label: 'Server', value: 'Hetzner 46.224.200.180 · SSH port 8022' },
  { label: 'Domain', value: 'training.rinosbike.com · Nginx · Let\'s Encrypt SSL' },
  { label: 'Deploy', value: 'git pull → systemctl restart training → npm run build' },
]

const OAUTH_FLOW = [
  { step: '1', label: 'User clicks Connect', detail: 'GET /api/sync/{provider}/connect — JWT passed as state param' },
  { step: '2', label: 'Redirect to provider', detail: 'User authorizes on Strava / Suunto OAuth page' },
  { step: '3', label: 'Callback received', detail: '/api/sync/{provider}/callback?code=...&state=<jwt>' },
  { step: '4', label: 'Token exchange', detail: 'POST to provider token endpoint → access + refresh tokens' },
  { step: '5', label: 'Tokens stored', detail: 'training.sync_tokens — auto-refresh when < 5 min to expiry' },
  { step: '6', label: 'Sync Now / Webhook', detail: 'Fetch activities → map → match plan → upsert workout_logs' },
]

const PLATFORM_EMOJI = { strava: '🚀', suunto: '⌚' }

export default function Branding() {
  const { data: icons = {} } = useQuery({
    queryKey: ['platform-icons'],
    queryFn: () => api.get('/api/admin/platform-icons').then(r => r.data),
  })

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold">App Info & Integrations</h1>
        <p className="text-primary-200 text-sm">Architecture, data flows, and platform connections</p>
      </div>

      <div className="px-4 mt-4 space-y-4">

        {/* Identity */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center gap-4 mb-3">
            <div className="w-14 h-14 rounded-2xl bg-primary-600 flex items-center justify-center text-2xl">🏋️</div>
            <div>
              <h2 className="font-bold text-gray-900 text-lg">Training Plans</h2>
              <p className="text-sm text-gray-500">training.rinosbike.com</p>
              <p className="text-xs text-gray-400">Ironman · Triathlon · Marathon coaching</p>
            </div>
          </div>
          <p className="text-sm text-gray-600">
            AI-powered endurance training platform with goal-based periodization, nutrition tracking, device sync, and real-time coaching.
          </p>
        </div>

        {/* Tech stack */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="font-semibold text-gray-900 mb-3">Tech Stack</h3>
          <div className="space-y-2">
            {TECH_STACK.map(t => (
              <div key={t.label} className="flex gap-3 text-sm">
                <span className="text-gray-400 shrink-0 w-20 font-medium">{t.label}</span>
                <span className="text-gray-700 font-mono text-xs leading-5">{t.value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* OAuth flow */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="font-semibold text-gray-900 mb-3">OAuth Sync Flow</h3>
          <div className="space-y-2">
            {OAUTH_FLOW.map(step => (
              <div key={step.step} className="flex gap-3">
                <span className="w-6 h-6 rounded-full bg-primary-600 text-white text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">{step.step}</span>
                <div>
                  <p className="text-sm font-medium text-gray-800">{step.label}</p>
                  <p className="text-xs text-gray-500 font-mono">{step.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Integration cards */}
        {INTEGRATIONS.map(intg => (
          <div key={intg.id} className={`bg-white rounded-2xl border ${intg.border} overflow-hidden`}>
            <div className={`px-4 pt-4 pb-3 ${intg.bg} flex items-center gap-3`}>
              {icons[intg.id] ? (
                <img src={icons[intg.id]} alt={intg.name} className="w-10 h-10 rounded-xl object-contain bg-white p-1 shadow-sm" />
              ) : (
                <span className="text-3xl">{PLATFORM_EMOJI[intg.id] || intg.icon}</span>
              )}
              <div className="flex-1">
                <h3 className={`font-bold ${intg.color}`}>{intg.name}</h3>
                <p className="text-xs text-gray-500">{intg.description}</p>
              </div>
              <span className="text-xs px-2 py-0.5 rounded-full bg-white border border-gray-200 text-gray-500">
                {intg.status}
              </span>
            </div>

            <div className="px-4 py-3 space-y-3">
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Capabilities</p>
                <ul className="space-y-0.5">
                  {intg.capabilities.map(c => (
                    <li key={c} className="text-xs text-gray-600 flex gap-1.5">
                      <span className="text-green-500">✓</span>{c}
                    </li>
                  ))}
                </ul>
              </div>

              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Data Flow</p>
                <p className="text-xs text-gray-600 font-mono bg-gray-50 rounded-lg px-2 py-1.5">{intg.dataFlow}</p>
              </div>

              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="text-gray-400 font-medium mb-0.5">Developer Portal</p>
                  <a href={intg.setupUrl} target="_blank" rel="noopener noreferrer" className="text-primary-600 underline break-all">{intg.setupUrl}</a>
                </div>
                <div>
                  <p className="text-gray-400 font-medium mb-0.5">Callback URL</p>
                  <p className="text-gray-600 font-mono break-all">{intg.callbackUrl}</p>
                </div>
              </div>

              {intg.note && (
                <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-2 py-1.5">{intg.note}</p>
              )}
            </div>
          </div>
        ))}

        {/* Auto-match logic */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h3 className="font-semibold text-gray-900 mb-2">Activity → Plan Matching Algorithm</h3>
          <div className="space-y-1.5 text-xs text-gray-600">
            <p>When an imported activity matches a planned workout, it is linked automatically:</p>
            <div className="bg-gray-50 rounded-xl px-3 py-2 font-mono space-y-0.5">
              <p>same_date = activity.log_date == plan_day.date</p>
              <p>same_sport = activity.sport == workout.sport</p>
              <p>duration_diff = |actual - planned| / planned</p>
              <p>match = same_date AND same_sport AND duration_diff &lt; 0.40</p>
            </div>
            <p>Best match (smallest diff) wins. Unmatched activities are still saved and visible in Sync history.</p>
          </div>
        </div>

      </div>
      <BottomNav />
    </div>
  )
}
