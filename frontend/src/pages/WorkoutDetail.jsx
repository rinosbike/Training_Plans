import { useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import { SportBadge } from '../components/workout/SportIcon'
import toast from 'react-hot-toast'

const zoneInfo = {
  1: { label: 'Zone 1 — Recovery', desc: 'Very easy, can hold full conversation', color: 'bg-green-100 text-green-700' },
  2: { label: 'Zone 2 — Aerobic',  desc: 'Easy, comfortable, aerobic base building', color: 'bg-green-200 text-green-800' },
  3: { label: 'Zone 3 — Tempo',    desc: 'Comfortably hard, limited conversation', color: 'bg-yellow-100 text-yellow-700' },
  4: { label: 'Zone 4 — Threshold',desc: 'Hard, only short sentences', color: 'bg-orange-100 text-orange-700' },
  5: { label: 'Zone 5 — VO2max',   desc: 'Very hard, cannot speak', color: 'bg-red-100 text-red-700' },
}

const HR_ZONES = [
  { z: 1, name: 'Recovery',  pct: [0.50, 0.60], bar: 'bg-green-200',   text: 'text-green-900',   border: 'border-green-200' },
  { z: 2, name: 'Aerobic',   pct: [0.60, 0.70], bar: 'bg-teal-300',    text: 'text-teal-900',    border: 'border-teal-200' },
  { z: 3, name: 'Tempo',     pct: [0.70, 0.80], bar: 'bg-yellow-300',  text: 'text-yellow-900',  border: 'border-yellow-300' },
  { z: 4, name: 'Threshold', pct: [0.80, 0.90], bar: 'bg-orange-400',  text: 'text-white',       border: 'border-orange-300' },
  { z: 5, name: 'VO2max',    pct: [0.90, 1.00], bar: 'bg-red-500',     text: 'text-white',       border: 'border-red-400' },
]

// Zone colors for Strava zone distribution bars
const ZONE_COLORS = ['bg-blue-300', 'bg-green-300', 'bg-yellow-300', 'bg-orange-400', 'bg-red-500']
const ZONE_TEXT   = ['text-blue-800', 'text-green-800', 'text-yellow-800', 'text-orange-800', 'text-red-700']

function HRZones({ maxHr, activeZone }) {
  if (!maxHr) return (
    <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2.5 mt-3">
      Set your max HR in Settings to see heart rate zone targets.
    </p>
  )
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Heart Rate Zones (max {maxHr} bpm)</p>
      {HR_ZONES.map(z => {
        const lo = Math.round(z.pct[0] * maxHr)
        const hi = z.z === 5 ? maxHr : Math.round(z.pct[1] * maxHr)
        const active = z.z === activeZone
        return (
          <div key={z.z} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${z.bar} ${z.border} transition-all ${active ? 'ring-2 ring-primary-500 ring-offset-1' : 'opacity-75'}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${active ? 'bg-white/90 text-gray-800 shadow-sm' : 'bg-white/50 text-gray-700'}`}>
              {z.z}
            </div>
            <span className={`flex-1 text-sm font-semibold ${z.text}`}>Z{z.z} — {z.name}</span>
            <span className={`text-sm font-mono font-bold tabular-nums ${z.text}`}>{lo}–{hi} bpm</span>
            {active && (
              <span className={`text-xs px-2 py-0.5 rounded-full bg-white/30 font-medium ${z.text}`}>Target</span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtPace(speedMs) {
  if (!speedMs || speedMs <= 0) return '—'
  const secPerKm = 1000 / speedMs
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtSpeed(speedMs) {
  if (!speedMs) return '—'
  return `${(speedMs * 3.6).toFixed(1)} km/h`
}

function fmtDuration(sec) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${m}:${String(s).padStart(2,'0')}`
}

function fmtElev(m) {
  if (m == null) return '—'
  const sign = m > 0 ? '+' : ''
  return `${sign}${Math.round(m)}m`
}

function isRunSport(sportType) {
  return /run|walk|hike/i.test(sportType || '')
}

// ---------------------------------------------------------------------------
// Strava Analysis component
// ---------------------------------------------------------------------------

function ZoneBar({ label, buckets, unit = 'bpm' }) {
  if (!buckets || buckets.length === 0) return null
  const totalSec = buckets.reduce((s, b) => s + (b.time || 0), 0)
  if (totalSec === 0) return null

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</p>
      {/* Stacked bar */}
      <div className="flex h-3 rounded-full overflow-hidden mb-3">
        {buckets.map((b, i) => {
          const pct = totalSec > 0 ? (b.time / totalSec) * 100 : 0
          if (pct < 0.5) return null
          return (
            <div key={i} className={`${ZONE_COLORS[i] || 'bg-gray-300'} transition-all`} style={{ width: `${pct}%` }} />
          )
        })}
      </div>
      {/* Zone rows */}
      <div className="space-y-1.5">
        {buckets.map((b, i) => {
          const pct = totalSec > 0 ? (b.time / totalSec) * 100 : 0
          const rangeLabel = b.max === -1
            ? `Z${i+1} — ${b.min}+ ${unit}`
            : `Z${i+1} — ${b.min}–${b.max} ${unit}`
          return (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${ZONE_COLORS[i] || 'bg-gray-300'}`} />
              <span className="text-xs text-gray-600 flex-1">{rangeLabel}</span>
              <span className="text-xs font-mono text-gray-500 w-10 text-right">{fmtDuration(b.time)}</span>
              <span className={`text-xs font-semibold w-9 text-right ${ZONE_TEXT[i] || 'text-gray-600'}`}>
                {pct < 1 ? '<1' : Math.round(pct)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function SplitsTable({ splits, sportType }) {
  const isRun = isRunSport(sportType)
  if (!splits || splits.length === 0) return null

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Per-km splits
      </p>
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400">
              <th className="text-left px-1 pb-1.5 font-medium w-8">km</th>
              <th className="text-right px-1 pb-1.5 font-medium">{isRun ? 'Pace' : 'Speed'}</th>
              {isRun && <th className="text-right px-1 pb-1.5 font-medium hidden sm:table-cell">GAP</th>}
              <th className="text-right px-1 pb-1.5 font-medium">HR</th>
              <th className="text-right px-1 pb-1.5 font-medium">Elev</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {splits.map((s, i) => {
              const hr = s.average_heartrate ? Math.round(s.average_heartrate) : null
              const elev = s.elevation_difference
              const elevSign = elev > 0 ? '+' : ''
              const isLast = i === splits.length - 1
              const distLabel = isLast && s.distance < 950 ? `${(s.distance / 1000).toFixed(2)}` : `${s.split}`

              // Colour-code pace: find min/max speed across splits for relative colour
              const speed = s.average_speed || 0
              const speeds = splits.map(x => x.average_speed || 0).filter(Boolean)
              const minSpd = Math.min(...speeds), maxSpd = Math.max(...speeds)
              const relSpd = speeds.length > 1 && maxSpd > minSpd
                ? (speed - minSpd) / (maxSpd - minSpd)
                : 0.5
              const paceColor = isRun
                ? relSpd > 0.66 ? 'text-green-700' : relSpd > 0.33 ? 'text-gray-700' : 'text-red-600'
                : 'text-gray-700'

              return (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                  <td className="px-1 py-1.5 font-mono text-gray-500">{distLabel}</td>
                  <td className={`px-1 py-1.5 font-mono font-semibold text-right ${paceColor}`}>
                    {isRun ? fmtPace(speed) : fmtSpeed(speed)}
                  </td>
                  {isRun && (
                    <td className="px-1 py-1.5 font-mono text-right text-gray-400 hidden sm:table-cell">
                      {s.average_grade_adjusted_speed ? fmtPace(s.average_grade_adjusted_speed) : '—'}
                    </td>
                  )}
                  <td className="px-1 py-1.5 font-mono text-right text-rose-600">
                    {hr ? `${hr}` : '—'}
                  </td>
                  <td className={`px-1 py-1.5 font-mono text-right ${elev > 0 ? 'text-orange-600' : elev < -1 ? 'text-blue-500' : 'text-gray-400'}`}>
                    {elev != null ? `${elevSign}${Math.round(elev)}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {isRun && (
          <p className="text-[10px] text-gray-400 mt-1.5 px-1">
            GAP = Grade Adjusted Pace · HR in bpm · Elev in metres
          </p>
        )}
      </div>
    </div>
  )
}

function LapsTable({ laps, sportType }) {
  // Only show laps if there are multiple meaningful ones (not auto-lap duplicating splits)
  if (!laps || laps.length <= 1) return null
  const isRun = isRunSport(sportType)

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        Laps ({laps.length})
      </p>
      <div className="space-y-1.5">
        {laps.map((lap, i) => {
          const distKm = lap.distance ? (lap.distance / 1000).toFixed(2) : '—'
          const speed = isRun ? fmtPace(lap.average_speed) : fmtSpeed(lap.average_speed)
          const hr = lap.average_heartrate ? Math.round(lap.average_heartrate) : null
          const watts = lap.average_watts ? Math.round(lap.average_watts) : null
          return (
            <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
              <span className="text-xs font-bold text-gray-400 w-5 shrink-0">{i + 1}</span>
              <span className="text-xs text-gray-500 w-12">{fmtDuration(lap.moving_time)}</span>
              <span className="text-xs text-gray-500 w-12">{distKm} km</span>
              <span className="text-xs font-semibold text-gray-700 flex-1">{speed}</span>
              {hr && <span className="text-xs text-rose-600">{hr} bpm</span>}
              {watts && <span className="text-xs text-purple-600">{watts}W</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StravaAnalysis({ workoutId, sport }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ['strava-analysis', workoutId],
    queryFn: () => api.get(`/api/workouts/${workoutId}/strava-analysis`).then(r => r.data),
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-4">
          <StravaLogo />
          <span className="text-sm font-semibold text-gray-700">Loading Strava analysis…</span>
        </div>
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (isError || !data) return null

  const hrZone  = data.zones?.find(z => z.type === 'heartrate')
  const pwrZone = data.zones?.find(z => z.type === 'power')
  const isRun   = isRunSport(data.sport_type || sport)

  // Extra summary stats to show
  const extras = [
    data.total_elevation_gain != null && { label: 'Elevation', value: `${Math.round(data.total_elevation_gain)} m ↑` },
    data.average_cadence      != null && { label: isRun ? 'Cadence' : 'Cadence', value: `${Math.round(data.average_cadence * (isRun ? 2 : 1))} ${isRun ? 'spm' : 'rpm'}` },
    data.weighted_average_watts != null && data.device_watts && { label: 'Norm Power', value: `${Math.round(data.weighted_average_watts)} W` },
    data.max_watts            != null && data.device_watts && { label: 'Max Power', value: `${Math.round(data.max_watts)} W` },
    data.kilojoules           != null && { label: 'Energy', value: `${Math.round(data.kilojoules)} kJ` },
    data.suffer_score         != null && { label: 'Relative Effort', value: data.suffer_score },
    data.average_temp         != null && { label: 'Avg Temp', value: `${data.average_temp}°C` },
    data.pr_count             > 0     && { label: 'Segment PRs', value: `🏆 ${data.pr_count}` },
    data.kudos_count          > 0     && { label: 'Kudos', value: `👍 ${data.kudos_count}` },
  ].filter(Boolean)

  const hasSplits = data.splits_metric?.length > 0
  const hasLaps   = data.laps?.length > 1
  const hasZones  = hrZone?.distribution_buckets?.length > 0 || pwrZone?.distribution_buckets?.length > 0

  if (!hasSplits && !hasLaps && !hasZones && extras.length === 0) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      {/* Header */}
      <div className="px-4 pt-4 pb-3 flex items-center gap-2.5 border-b border-gray-50">
        <StravaLogo />
        <div>
          <h2 className="font-semibold text-gray-900 text-sm leading-tight">Strava Analysis</h2>
          {data.name && <p className="text-xs text-gray-400 truncate max-w-[220px]">{data.name}</p>}
        </div>
        <a
          href={`https://www.strava.com/activities/${data.activity_id}`}
          target="_blank" rel="noopener noreferrer"
          className="ml-auto text-xs text-orange-500 font-medium"
        >
          View ↗
        </a>
      </div>

      <div className="px-4 pb-5 pt-3 space-y-5">

        {/* Extra stats grid */}
        {extras.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            {extras.map(e => (
              <div key={e.label} className="bg-gray-50 rounded-xl p-2.5 text-center">
                <p className="text-sm font-bold text-gray-900">{e.value}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{e.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* HR zone distribution */}
        {hrZone?.distribution_buckets?.length > 0 && (
          <ZoneBar label="Heart Rate Zones" buckets={hrZone.distribution_buckets} unit="bpm" />
        )}

        {/* Power zone distribution */}
        {pwrZone?.distribution_buckets?.length > 0 && (
          <ZoneBar label="Power Zones" buckets={pwrZone.distribution_buckets} unit="W" />
        )}

        {/* Per-km splits */}
        {hasSplits && (
          <SplitsTable splits={data.splits_metric} sportType={data.sport_type || sport} />
        )}

        {/* Laps (structured workouts) */}
        {hasLaps && (
          <LapsTable laps={data.laps} sportType={data.sport_type || sport} />
        )}

      </div>
    </div>
  )
}

function StravaLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="none">
      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066z" fill="#FC4C02"/>
      <path d="M11.587 13.828L9.5 9.713 7.41 13.828H3.344l6.156-12.171 6.154 12.171z" fill="#FC4C02" opacity=".6"/>
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WorkoutDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [logging, setLogging] = useState(false)
  const [logData, setLogData] = useState({ actual_duration_min: '', actual_distance_km: '', avg_hr: '', max_hr: '', perceived_effort: '', notes: '' })

  const { data: workout, isLoading } = useQuery({
    queryKey: ['workout', id],
    queryFn: () => api.get(`/api/workouts/${id}`).then(r => r.data),
  })

  const { data: profile = {} } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get('/api/profile').then(r => r.data),
  })

  const logMutation = useMutation({
    mutationFn: (d) => api.post(`/api/workouts/${id}/log`, d),
    onSuccess: () => {
      toast.success('Workout logged!')
      qc.invalidateQueries(['workout', id])
      qc.invalidateQueries(['plan-days'])
      setLogging(false)
    },
    onError: () => toast.error('Failed to save log'),
  })

  if (isLoading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin h-8 w-8 border-b-2 border-primary-600 rounded-full" /></div>
  if (!workout) return null

  const zone = zoneInfo[workout.intensity_zone] || zoneInfo[2]
  const isLogged = !!workout.log_id
  const isStrava = workout.log_source === 'strava'

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="text-primary-600 text-sm font-medium mb-2">← Back</button>
        <div className="flex items-center gap-3">
          <SportBadge sport={workout.sport} size="lg" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">{workout.title}</h1>
            <p className="text-gray-500 text-sm capitalize">{workout.day_type} · {new Date(workout.date+'T00:00:00').toLocaleDateString('en-GB',{weekday:'long',month:'short',day:'numeric'})}</p>
          </div>
          {isLogged && <span className="ml-auto bg-green-100 text-green-700 text-xs font-medium px-2 py-1 rounded-full">Completed ✓</span>}
        </div>
      </div>

      <div className="px-4 mt-4 space-y-4">
        {/* Plan metrics */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Planned</h2>
          <div className="grid grid-cols-3 gap-3">
            <Metric label="Duration" value={workout.duration_min ? `${workout.duration_min} min` : '—'} />
            <Metric label="Distance" value={workout.distance_km ? `${workout.distance_km} km` : '—'} />
            <Metric label="TSS" value={workout.tss || '—'} />
          </div>
          <div className={`mt-3 px-3 py-2 rounded-xl text-sm font-medium ${zone.color}`}>
            {zone.label} — {zone.desc}
          </div>
          {workout.description && <p className="mt-3 text-sm text-gray-600">{workout.description}</p>}

          {/* HR Zones */}
          <HRZones maxHr={profile?.max_hr} activeZone={workout.intensity_zone} />
        </div>

        {/* Actual log summary */}
        {isLogged && !logging && (
          <div className="bg-green-50 rounded-2xl border border-green-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900">Completed</h2>
              {isStrava && (
                <span className="flex items-center gap-1 text-xs text-orange-500 font-medium">
                  <StravaLogo /> via Strava
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Duration" value={workout.actual_duration_min ? `${workout.actual_duration_min} min` : '—'} />
              <Metric label="Distance" value={workout.actual_distance_km ? `${workout.actual_distance_km} km` : '—'} />
              <Metric label="Avg HR" value={workout.avg_hr ? `${workout.avg_hr} bpm` : '—'} />
              <Metric label="Max HR" value={workout.max_hr ? `${workout.max_hr} bpm` : '—'} />
              <Metric label="RPE" value={workout.perceived_effort ? `${workout.perceived_effort}/10` : '—'} />
              <Metric label="Calories" value={workout.calories_burned ? `${workout.calories_burned} kcal` : '—'} />
            </div>
            {workout.log_notes && <p className="mt-2 text-sm text-gray-600">{workout.log_notes}</p>}
            {!isStrava && (
              <button onClick={() => setLogging(true)} className="mt-3 text-sm text-primary-600 font-medium">Edit log</button>
            )}
          </div>
        )}

        {/* Strava rich analysis — shown when synced from Strava */}
        {isStrava && isLogged && (
          <StravaAnalysis workoutId={id} sport={workout.sport} />
        )}

        {/* Manual log form */}
        {!isStrava && (logging || !isLogged) && workout.sport !== 'rest' && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Log This Workout</h2>
            <div className="space-y-3">
              <LogField label="Duration (min)" type="number" value={logData.actual_duration_min} onChange={v => setLogData(p => ({...p, actual_duration_min: v}))} placeholder={workout.duration_min} />
              <LogField label="Distance (km)" type="number" value={logData.actual_distance_km} onChange={v => setLogData(p => ({...p, actual_distance_km: v}))} placeholder={workout.distance_km} />
              <div className="grid grid-cols-2 gap-3">
                <LogField label="Avg HR (bpm)" type="number" value={logData.avg_hr} onChange={v => setLogData(p => ({...p, avg_hr: v}))} placeholder="145" />
                <LogField label="Max HR (bpm)" type="number" value={logData.max_hr} onChange={v => setLogData(p => ({...p, max_hr: v}))} placeholder="165" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Perceived Effort (1-10)</label>
                <div className="flex gap-1">
                  {[1,2,3,4,5,6,7,8,9,10].map(n => (
                    <button key={n} onClick={() => setLogData(p => ({...p, perceived_effort: n}))}
                      className={`flex-1 py-2 text-xs rounded-lg font-medium ${logData.perceived_effort===n ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <LogField label="Notes" value={logData.notes} onChange={v => setLogData(p => ({...p, notes: v}))} placeholder="How did it feel?" />
            </div>
            <div className="flex gap-2 mt-4">
              {logging && <button onClick={() => setLogging(false)} className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-medium">Cancel</button>}
              <button
                onClick={() => logMutation.mutate(logData)}
                disabled={logMutation.isPending}
                className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white font-medium active:bg-primary-700 disabled:opacity-50"
              >
                {logMutation.isPending ? 'Saving...' : 'Save Log'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="text-center">
      <p className="text-lg font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}

function LogField({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white" />
    </div>
  )
}
