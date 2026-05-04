import { useTranslation } from 'react-i18next'
import { SportBadge } from '../workout/SportIcon'
const DAY_TYPE_COLORS = {
  rest:     'bg-gray-100 text-gray-500',
  easy:     'bg-green-100 text-green-700',
  tempo:    'bg-yellow-100 text-yellow-700',
  interval: 'bg-orange-100 text-orange-700',
  long:     'bg-blue-100 text-blue-700',
  race:     'bg-red-100 text-red-700',
  strength: 'bg-purple-100 text-purple-700',
  brick:    'bg-amber-100 text-amber-700',
  core:     'bg-pink-100 text-pink-700',
  swim:     'bg-cyan-100 text-cyan-700',
  cycle:    'bg-indigo-100 text-indigo-700',
}

export default function DayCard({ day, isToday, isSelected, onClick }) {
  const { i18n } = useTranslation()
  const d = new Date(day.date + 'T00:00:00')
  const dayName = d.toLocaleDateString(i18n.language, { weekday: 'short' })
  const dayNum = d.getDate()
  const workouts = day.workouts || []
  const isRest = day.day_type === 'rest'
  const allLogged = workouts.length > 0 && workouts.every(w => w.log)
  const someLogged = workouts.some(w => w.log)

  return (
    <button
      onClick={() => onClick(day)}
      className={`flex flex-col items-center p-2 rounded-xl transition-all min-w-[52px] ${
        isSelected ? 'bg-primary-600 shadow-md' : isToday ? 'bg-primary-50 border border-primary-300' : 'bg-white'
      }`}
    >
      {/* Day name */}
      <span className={`text-xs font-medium mb-1 ${isSelected ? 'text-primary-100' : 'text-gray-500'}`}>
        {dayName}
      </span>

      {/* Day number */}
      <span className={`text-base font-bold mb-2 ${isSelected ? 'text-white' : isToday ? 'text-primary-600' : 'text-gray-900'}`}>
        {dayNum}
      </span>

      {/* Sport icons or rest */}
      {isRest ? (
        <span className="text-lg">💤</span>
      ) : (
        <div className="flex flex-col gap-1 items-center">
          {workouts.slice(0, 2).map((w, i) => (
            <SportBadge key={i} sport={w.sport} size="sm" />
          ))}
          {workouts.length > 2 && (
            <span className="text-xs text-gray-400">+{workouts.length - 2}</span>
          )}
        </div>
      )}

      {/* Completion dot */}
      <div className="mt-1.5 h-1.5 w-1.5 rounded-full">
        {allLogged ? (
          <div className="h-1.5 w-1.5 rounded-full bg-green-500" />
        ) : someLogged ? (
          <div className="h-1.5 w-1.5 rounded-full bg-yellow-400" />
        ) : !isRest ? (
          <div className="h-1.5 w-1.5 rounded-full bg-gray-300" />
        ) : null}
      </div>
    </button>
  )
}
