import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { SportBadge } from './SportIcon'

const zoneColors = ['', 'bg-green-200 text-green-800', 'bg-green-400 text-white',
                    'bg-yellow-400 text-white', 'bg-orange-500 text-white', 'bg-red-500 text-white']

const SOURCE_ICON = { strava: '🚀', suunto: '⌚', manual: '✏️' }

function StatPill({ label, value, unit, highlight }) {
  if (!value && value !== 0) return null
  return (
    <div className={`flex flex-col items-center px-3 py-2 rounded-xl ${highlight ? 'bg-primary-50' : 'bg-gray-50'}`}>
      <span className={`text-sm font-bold ${highlight ? 'text-primary-700' : 'text-gray-800'}`}>
        {value}{unit && <span className="text-xs font-normal ml-0.5">{unit}</span>}
      </span>
      <span className="text-xs text-gray-400 mt-0.5">{label}</span>
    </div>
  )
}

function ActivityLog({ log, plannedMin }) {
  const { t } = useTranslation('workouts')
  if (!log) return null
  const src = log.source || 'manual'
  const durationDiff = plannedMin && log.actual_duration_min
    ? Math.round(log.actual_duration_min - plannedMin)
    : null

  return (
    <div className="mt-3 pt-3 border-t border-green-200">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-base">{SOURCE_ICON[src] || '📊'}</span>
        <span className="text-xs font-semibold text-green-700 uppercase tracking-wide">
          {t(`source.${src}`, src)}
        </span>
        {log.notes && (
          <span className="text-xs text-gray-400 truncate flex-1">— {log.notes}</span>
        )}
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatPill label={t('fields.duration')} value={log.actual_duration_min ? `${Math.round(log.actual_duration_min)}` : null} unit="min" highlight />
        <StatPill label={t('fields.distance')} value={log.actual_distance_km ? `${log.actual_distance_km}` : null} unit="km" />
        <StatPill label={t('fields.avgHr')} value={log.avg_hr} unit="bpm" />
        <StatPill label={t('fields.maxHr')} value={log.max_hr} unit="bpm" />
        <StatPill label={t('fields.power')} value={log.avg_power_watts} unit="W" highlight={!!log.avg_power_watts} />
        <StatPill label={t('fields.calories')} value={log.calories_burned} unit="kcal" />
      </div>

      {durationDiff !== null && (
        <p className={`text-xs mt-2 font-medium ${durationDiff >= 0 ? 'text-green-600' : 'text-amber-600'}`}>
          {t('vsplan', { diff: durationDiff >= 0 ? `+${durationDiff}` : durationDiff })}
          {log.perceived_effort && ` · ${t('fields.rpe')} ${log.perceived_effort}/10`}
        </p>
      )}
    </div>
  )
}

function localDesc(workout, lang) {
  const t = workout.description_translations
  if (t && lang !== 'en') return t[lang] || workout.description
  return workout.description
}

export default function WorkoutCard({ workout, compact = false }) {
  const navigate = useNavigate()
  const { t, i18n } = useTranslation('workouts')
  const logged = !!workout.log

  // Standalone synced activity — no linked plan workout, clickable to show full Strava analysis
  if (workout.is_unplanned) {
    return (
      <button
        onClick={() => navigate(`/workout/${workout.id}`)}
        className="w-full text-left rounded-xl border bg-green-50 border-green-200 p-4 hover:bg-green-100 transition-colors"
      >
        <div className="flex items-start gap-3">
          <SportBadge sport={workout.sport} />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-gray-900 truncate">{workout.title}</h3>
            <div className="flex flex-wrap gap-2 mt-0.5">
              {workout.duration_min && <span className="text-sm text-gray-600">{workout.duration_min} min</span>}
              {workout.distance_km && <span className="text-sm text-gray-600">{workout.distance_km} km</span>}
            </div>
          </div>
          <span className="text-green-600 text-sm">✓</span>
        </div>
        <ActivityLog log={workout.log} plannedMin={null} />
      </button>
    )
  }

  if (compact) return (
    <button
      onClick={() => navigate(`/workout/${workout.id}`)}
      className="flex items-center gap-2 w-full text-left"
    >
      <SportBadge sport={workout.sport} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-800 truncate">
          {workout.title_key ? t(`titles.${workout.title_key}`, workout.title) : workout.title}
        </p>
        <p className="text-xs text-gray-500">{workout.duration_min}min · Z{workout.intensity_zone} {t(`zones.${workout.intensity_zone}.name`, '')}</p>
      </div>
      {logged && <span className="text-green-500 text-xs">✓</span>}
    </button>
  )

  return (
    <div
      className={`rounded-xl border p-4 transition-all ${
        logged ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200'
      }`}
    >
      {/* Planned workout header — tappable to detail */}
      <button
        onClick={() => navigate(`/workout/${workout.id}`)}
        className="w-full text-left"
      >
        <div className="flex items-start gap-3">
          <SportBadge sport={workout.sport} />
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-semibold text-gray-900 truncate">
                {workout.title_key ? t(`titles.${workout.title_key}`, workout.title) : workout.title}
              </h3>
              {logged && <span className="text-green-600 text-sm">✓</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              <span className="text-sm text-gray-600">{workout.duration_min} min</span>
              {workout.distance_km && (
                <span className="text-sm text-gray-600">{workout.distance_km} km</span>
              )}
              <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${zoneColors[workout.intensity_zone] || ''}`}>
                Z{workout.intensity_zone} · {t(`zones.${workout.intensity_zone}.name`, `Zone ${workout.intensity_zone}`)}
              </span>
            </div>
            {workout.description && (
              <p className="text-sm text-gray-500 mt-1 line-clamp-2">{localDesc(workout, i18n.language)}</p>
            )}
          </div>
        </div>
      </button>

      {/* Strava / Suunto activity data */}
      <ActivityLog log={workout.log} plannedMin={workout.duration_min} />
    </div>
  )
}
