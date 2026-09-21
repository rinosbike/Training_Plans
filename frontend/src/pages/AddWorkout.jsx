import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import toast from 'react-hot-toast'
import api from '../services/api'
import { SportBadge } from '../components/workout/SportIcon'
import { LogField, ExerciseSetLogger } from '../components/workout/LogFormParts'

const SPORTS = ['run', 'cycle', 'swim', 'strength', 'core', 'brick']
const SETS_SPORTS = ['strength', 'core']

function todayStr() {
  const d = new Date()
  const pad = n => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Log a workout that isn't in the plan: rest day, an extra session, or a day
// outside any generated plan. Saved as a standalone (workout_id NULL) manual log.
export default function AddWorkout() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params] = useSearchParams()
  const { t } = useTranslation('workouts')
  const { t: tc } = useTranslation('common')

  const [sport, setSport] = useState('strength')
  const [logDate, setLogDate] = useState(params.get('date') || todayStr())
  const [logData, setLogData] = useState({
    actual_duration_min: '', actual_distance_km: '',
    avg_hr: '', max_hr: '', perceived_effort: '', notes: '',
  })
  const [exerciseSets, setExerciseSets] = useState([])

  const isSetsSport = SETS_SPORTS.includes(sport)

  const { data: exerciseLibrary = [] } = useQuery({
    queryKey: ['exercises'],
    queryFn: () => api.get('/api/exercises').then(r => r.data),
    enabled: isSetsSport,
  })

  const createMutation = useMutation({
    mutationFn: (payload) => api.post('/api/workout-logs', payload).then(r => r.data),
    onSuccess: (log) => {
      toast.success(t('saveLog'))
      qc.invalidateQueries(['plan-days'])
      navigate(`/workout/${log.id}`, { replace: true })
    },
    onError: (err) => toast.error(err?.response?.data?.error || tc('error')),
  })

  const setField = (k) => (v) => setLogData(p => ({ ...p, [k]: v }))

  const submit = () => {
    const payload = { ...logData, sport, log_date: logDate }
    if (isSetsSport) {
      payload.sets = exerciseSets
        .filter(s => s.exercise_id && (s.reps !== '' || s.duration_sec !== ''))
        .map((s, i) => ({
          exercise_id: s.exercise_id,
          set_number: s.set_number || i + 1,
          reps: s.reps === '' ? null : parseInt(s.reps, 10),
          duration_sec: s.duration_sec === '' ? null : parseInt(s.duration_sec, 10),
          weight_kg: s.weight_kg === '' ? null : parseFloat(s.weight_kg),
        }))
    }
    const hasDuration = Number(logData.actual_duration_min) > 0
    if (!hasDuration && !(payload.sets && payload.sets.length)) {
      toast.error(t('addWorkoutNeedsData'))
      return
    }
    createMutation.mutate(payload)
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-24">
      <div className="bg-white border-b border-gray-200 px-4 lg:px-6 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="text-primary-600 text-sm font-medium mb-2">
          {tc('back')}
        </button>
        <h1 className="text-xl font-bold text-gray-900">{t('addWorkout')}</h1>
        <p className="text-gray-500 text-sm">{t('addWorkoutHint')}</p>
      </div>

      <div className="px-4 lg:px-6 mt-4 max-w-5xl mx-auto">
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.sport')}</label>
            <div className="grid grid-cols-3 gap-2">
              {SPORTS.map(s => (
                <button key={s} type="button" onClick={() => setSport(s)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-xl border text-sm font-medium ${
                    sport === s ? 'border-primary-600 bg-primary-50 text-primary-700' : 'border-gray-200 text-gray-700'
                  }`}>
                  <SportBadge sport={s} size="sm" />
                  {t(`sports.${s}`)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.date')}</label>
            <input type="date" value={logDate} max={todayStr()} onChange={e => e.target.value && setLogDate(e.target.value)}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white" />
          </div>

          <LogField label={t('fields.durationMin')} type="number" value={logData.actual_duration_min} onChange={setField('actual_duration_min')} />
          <LogField label={t('fields.distanceKm')} type="number" value={logData.actual_distance_km} onChange={setField('actual_distance_km')} />
          {isSetsSport && (
            <ExerciseSetLogger t={t} exercises={exerciseLibrary} sets={exerciseSets} onChange={setExerciseSets} />
          )}
          <div className="grid grid-cols-2 gap-3">
            <LogField label={t('fields.avgHrBpm')} type="number" value={logData.avg_hr} onChange={setField('avg_hr')} placeholder="145" />
            <LogField label={t('fields.maxHrBpm')} type="number" value={logData.max_hr} onChange={setField('max_hr')} placeholder="165" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.perceivedEffort')}</label>
            <div className="flex gap-1">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                <button key={n} type="button" onClick={() => setField('perceived_effort')(n)}
                  className={`flex-1 py-2 text-xs rounded-lg font-medium ${logData.perceived_effort === n ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          <LogField label={t('fields.notes')} value={logData.notes} onChange={setField('notes')} placeholder={t('fields.notesPlaceholder')} />

          <div className="flex gap-2 pt-1">
            <button onClick={() => navigate(-1)}
              className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-medium">
              {tc('cancel')}
            </button>
            <button onClick={submit} disabled={createMutation.isPending}
              className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white font-medium active:bg-primary-700 disabled:opacity-50">
              {createMutation.isPending ? tc('saving') : t('saveLog')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
