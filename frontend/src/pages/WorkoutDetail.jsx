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

        {/* Actual log */}
        {isLogged && !logging && (
          <div className="bg-green-50 rounded-2xl border border-green-200 p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Completed</h2>
            <div className="grid grid-cols-3 gap-3">
              <Metric label="Duration" value={workout.actual_duration_min ? `${workout.actual_duration_min} min` : '—'} />
              <Metric label="Distance" value={workout.actual_distance_km ? `${workout.actual_distance_km} km` : '—'} />
              <Metric label="Avg HR" value={workout.avg_hr ? `${workout.avg_hr} bpm` : '—'} />
              <Metric label="Max HR" value={workout.max_hr ? `${workout.max_hr} bpm` : '—'} />
              <Metric label="RPE" value={workout.perceived_effort ? `${workout.perceived_effort}/10` : '—'} />
              <Metric label="Calories" value={workout.calories_burned ? `${workout.calories_burned} kcal` : '—'} />
            </div>
            {workout.log_notes && <p className="mt-2 text-sm text-gray-600">{workout.log_notes}</p>}
            <button onClick={() => setLogging(true)} className="mt-3 text-sm text-primary-600 font-medium">Edit log</button>
          </div>
        )}

        {/* Log form */}
        {(logging || !isLogged) && workout.sport !== 'rest' && (
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
