import { useNavigate } from 'react-router-dom'
import { SportBadge } from './SportIcon'

const zoneColors = ['', 'bg-green-200 text-green-800', 'bg-green-400 text-white',
                    'bg-yellow-400 text-white', 'bg-orange-500 text-white', 'bg-red-500 text-white']

export default function WorkoutCard({ workout, compact = false }) {
  const navigate = useNavigate()
  const logged = !!workout.log

  if (compact) return (
    <button
      onClick={() => navigate(`/workout/${workout.id}`)}
      className="flex items-center gap-2 w-full text-left"
    >
      <SportBadge sport={workout.sport} size="sm" />
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-gray-800 truncate">{workout.title}</p>
        <p className="text-xs text-gray-500">{workout.duration_min}min · Z{workout.intensity_zone}</p>
      </div>
      {logged && <span className="text-green-500 text-xs">✓</span>}
    </button>
  )

  return (
    <button
      onClick={() => navigate(`/workout/${workout.id}`)}
      className={`w-full text-left rounded-xl border p-4 transition-all ${
        logged ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200 active:bg-gray-50'
      }`}
    >
      <div className="flex items-start gap-3">
        <SportBadge sport={workout.sport} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h3 className="font-semibold text-gray-900 truncate">{workout.title}</h3>
            {logged && <span className="text-green-600 text-sm">✓</span>}
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="text-sm text-gray-600">{workout.duration_min} min</span>
            {workout.distance_km && (
              <span className="text-sm text-gray-600">{workout.distance_km} km</span>
            )}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${zoneColors[workout.intensity_zone] || ''}`}>
              Zone {workout.intensity_zone}
            </span>
          </div>
          {workout.description && (
            <p className="text-sm text-gray-500 mt-1 line-clamp-2">{workout.description}</p>
          )}
        </div>
      </div>
    </button>
  )
}
