import { useRef } from 'react'

const SPORT_DOT = {
  cycle:    'bg-indigo-500',
  swim:     'bg-cyan-500',
  run:      'bg-green-500',
  strength: 'bg-purple-500',
  brick:    'bg-amber-500',
  core:     'bg-pink-500',
}

const DAY_TYPE_BG = {
  cycle:    'bg-indigo-50',
  swim:     'bg-cyan-50',
  easy:     'bg-green-50',
  tempo:    'bg-yellow-50',
  interval: 'bg-orange-50',
  long:     'bg-blue-50',
  race:     'bg-red-50',
  strength: 'bg-purple-50',
  brick:    'bg-amber-50',
  core:     'bg-pink-50',
}

function localDateStr(d) {
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1)
}

function monthLabel(d) {
  return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}

export default function MonthView({ days, selectedDate, onSelectDate, month, onMonthChange }) {
  const touchStartX = useRef(null)

  const dayMap = {}
  for (const d of days) dayMap[d.date] = d

  // Build calendar grid: Monday-start
  const firstDay = startOfMonth(month)
  const lastDay = new Date(month.getFullYear(), month.getMonth() + 1, 0)

  // Start from the Monday on or before the 1st
  const gridStart = new Date(firstDay)
  const dow = firstDay.getDay()
  gridStart.setDate(firstDay.getDate() - (dow === 0 ? 6 : dow - 1))

  // Build 6 weeks (42 days)
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(gridStart)
    d.setDate(gridStart.getDate() + i)
    return d
  })

  const today = localDateStr(new Date())

  function changeMonth(delta) {
    const next = new Date(month.getFullYear(), month.getMonth() + delta, 1)
    onMonthChange(next)
  }

  function handleTouchStart(e) { touchStartX.current = e.touches[0].clientX }
  function handleTouchEnd(e) {
    if (touchStartX.current === null) return
    const diff = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(diff) > 50) changeMonth(diff < 0 ? 1 : -1)
    touchStartX.current = null
  }

  const currentMonth = month.getMonth()

  return (
    <div
      className="bg-white rounded-2xl shadow-sm border border-gray-100"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Month header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <button onClick={() => changeMonth(-1)} className="p-2 text-gray-500 active:text-primary-600 text-lg">
          ‹
        </button>
        <span className="text-sm font-semibold text-gray-700">{monthLabel(month)}</span>
        <button onClick={() => changeMonth(1)} className="p-2 text-gray-500 active:text-primary-600 text-lg">
          ›
        </button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 px-2 pt-2 pb-1">
        {['M','T','W','T','F','S','S'].map((d, i) => (
          <div key={i} className="text-center text-xs font-medium text-gray-400 py-1">{d}</div>
        ))}
      </div>

      {/* Date grid */}
      <div className="grid grid-cols-7 px-2 pb-2 gap-y-1">
        {cells.map((cell, i) => {
          const dateStr = localDateStr(cell)
          const planDay = dayMap[dateStr]
          const isCurrentMonth = cell.getMonth() === currentMonth
          const isToday = dateStr === today
          const isSelected = dateStr === selectedDate
          const workouts = planDay?.workouts || []
          const dayType = planDay?.day_type
          const isRest = dayType === 'rest' || !planDay
          const cellBg = isSelected
            ? 'bg-primary-600'
            : isToday
            ? 'bg-primary-50 border border-primary-300'
            : (dayType && !isRest ? DAY_TYPE_BG[dayType] || 'bg-gray-50' : '')

          return (
            <button
              key={i}
              onClick={() => isCurrentMonth && onSelectDate(dateStr)}
              className={`relative flex flex-col items-center py-1.5 rounded-xl transition-colors min-h-[52px]
                ${isCurrentMonth ? 'cursor-pointer' : 'cursor-default opacity-30'}
                ${cellBg}
              `}
            >
              {/* Day number */}
              <span className={`text-xs font-semibold leading-none mb-1.5
                ${isSelected ? 'text-white' : isToday ? 'text-primary-600' : isCurrentMonth ? 'text-gray-700' : 'text-gray-400'}
              `}>
                {cell.getDate()}
              </span>

              {/* Sport dots */}
              {isCurrentMonth && !isRest && (
                <div className="flex flex-wrap justify-center gap-0.5 max-w-[36px]">
                  {workouts.slice(0, 3).map((w, j) => (
                    <span
                      key={j}
                      className={`w-1.5 h-1.5 rounded-full ${isSelected ? 'bg-white opacity-90' : SPORT_DOT[w.sport] || 'bg-gray-400'}`}
                    />
                  ))}
                </div>
              )}

              {/* Duration label for workout days */}
              {isCurrentMonth && workouts.length > 0 && (
                <span className={`text-[9px] mt-0.5 font-medium
                  ${isSelected ? 'text-primary-100' : 'text-gray-400'}
                `}>
                  {workouts.reduce((sum, w) => sum + (w.duration_min || 0), 0)}m
                </span>
              )}
            </button>
          )
        })}
      </div>
    </div>
  )
}
