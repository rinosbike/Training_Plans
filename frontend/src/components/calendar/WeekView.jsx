import { useState, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import DayCard from './DayCard'

function localDateStr(d) {
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

function startOfWeek(d) {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = day === 0 ? -6 : 1 - day  // Monday start
  dt.setDate(dt.getDate() + diff)
  dt.setHours(12,0,0,0)  // noon avoids UTC-offset date shift
  return dt
}

function formatWeekLabel(monday, lang) {
  const sunday = new Date(monday)
  sunday.setDate(sunday.getDate() + 6)
  const opts = { month: 'short', day: 'numeric' }
  return `${monday.toLocaleDateString(lang, opts)} – ${sunday.toLocaleDateString(lang, opts)}, ${monday.getFullYear()}`
}

export default function WeekView({ days, selectedDate, onSelectDate, onWeekChange }) {
  const { i18n } = useTranslation()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const touchStartX = useRef(null)

  const weekDates = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(d.getDate() + i)
    return localDateStr(d)
  })

  const dayMap = {}
  for (const d of days) dayMap[d.date] = d

  function changeWeek(delta) {
    const next = new Date(weekStart)
    next.setDate(next.getDate() + delta * 7)
    setWeekStart(next)
    onWeekChange && onWeekChange(next)
  }

  function handleTouchStart(e) { touchStartX.current = e.touches[0].clientX }
  function handleTouchEnd(e) {
    if (touchStartX.current === null) return
    const diff = e.changedTouches[0].clientX - touchStartX.current
    if (Math.abs(diff) > 50) changeWeek(diff < 0 ? 1 : -1)
    touchStartX.current = null
  }

  return (
    <div
      className="bg-white rounded-2xl shadow-sm border border-gray-100"
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      {/* Week header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <button onClick={() => changeWeek(-1)} className="p-1 text-gray-500 active:text-primary-600">
          ‹
        </button>
        <span className="text-sm font-semibold text-gray-700">{formatWeekLabel(weekStart, i18n.language)}</span>
        <button onClick={() => changeWeek(1)} className="p-1 text-gray-500 active:text-primary-600">
          ›
        </button>
      </div>

      {/* Day columns */}
      <div className="flex gap-1 p-2 overflow-x-auto scrollbar-hide">
        {weekDates.map((dateStr) => {
          const day = dayMap[dateStr] || { date: dateStr, day_type: 'rest', workouts: [] }
          const isToday = dateStr === localDateStr(new Date())
          return (
            <DayCard
              key={dateStr}
              day={day}
              isToday={isToday}
              isSelected={selectedDate === dateStr}
              onClick={(d) => onSelectDate(d.date)}
            />
          )
        })}
      </div>
    </div>
  )
}
