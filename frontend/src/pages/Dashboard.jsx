import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../services/api'
import BottomNav from '../components/BottomNav'
import WeekView from '../components/calendar/WeekView'
import MonthView from '../components/calendar/MonthView'
import WorkoutCard from '../components/workout/WorkoutCard'

const HR_ZONES = [
  { z: 1, name: 'Recovery',  pct: [0.50, 0.60], bg: 'bg-green-200',   text: 'text-green-900'  },
  { z: 2, name: 'Aerobic',   pct: [0.60, 0.70], bg: 'bg-teal-300',    text: 'text-teal-900'   },
  { z: 3, name: 'Tempo',     pct: [0.70, 0.80], bg: 'bg-yellow-300',  text: 'text-yellow-900' },
  { z: 4, name: 'Threshold', pct: [0.80, 0.90], bg: 'bg-orange-400',  text: 'text-white'      },
  { z: 5, name: 'VO2max',    pct: [0.90, 1.00], bg: 'bg-red-500',     text: 'text-white'      },
]

function HRZoneStrip({ maxHr }) {
  if (!maxHr) return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5 flex items-center gap-3">
      <span className="text-lg shrink-0">❤️</span>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-semibold text-amber-800">Set your Max HR to see heart rate zones</p>
        <p className="text-xs text-amber-700 mt-0.5">
          Simple estimate: <span className="font-bold">220 − your age</span>
          <span className="text-amber-600"> · More accurate: </span>
          <span className="font-bold">208 − (0.7 × age)</span>
          <span className="text-amber-600"> — set it in </span>
          <span className="font-semibold underline">Settings → Max HR</span>
        </p>
      </div>
    </div>
  )
  return (
    <div className="flex rounded-xl overflow-hidden shadow-sm">
      {HR_ZONES.map(z => {
        const lo = Math.round(z.pct[0] * maxHr)
        const hi = z.z === 5 ? maxHr : Math.round(z.pct[1] * maxHr)
        return (
          <div key={z.z} className={`flex-1 ${z.bg} py-1.5 flex flex-col items-center`}>
            <span className={`text-xs font-bold leading-none ${z.text}`}>Z{z.z}</span>
            <span className={`text-[10px] leading-tight tabular-nums ${z.text} opacity-80`}>{lo}–{hi}</span>
          </div>
        )
      })}
    </div>
  )
}

const DAY_TYPE_BADGE = {
  rest:     { label: 'Rest',      bg: 'bg-gray-100 text-gray-500' },
  easy:     { label: 'Easy',      bg: 'bg-green-100 text-green-700' },
  tempo:    { label: 'Tempo',     bg: 'bg-yellow-100 text-yellow-700' },
  interval: { label: 'Intervals', bg: 'bg-orange-100 text-orange-700' },
  long:     { label: 'Long',      bg: 'bg-blue-100 text-blue-700' },
  race:     { label: 'Race',      bg: 'bg-red-100 text-red-700' },
  strength: { label: 'Strength',  bg: 'bg-purple-100 text-purple-700' },
  brick:    { label: 'Brick',     bg: 'bg-amber-100 text-amber-700' },
  core:     { label: 'Core',      bg: 'bg-pink-100 text-pink-700' },
  swim:     { label: 'Swim',      bg: 'bg-cyan-100 text-cyan-700' },
  cycle:    { label: 'Ride',      bg: 'bg-indigo-100 text-indigo-700' },
}

function localDateStr(d) {
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

function startOfWeek(d) {
  const dt = new Date(d)
  const day = dt.getDay()
  dt.setDate(dt.getDate() - (day === 0 ? 6 : day - 1))
  dt.setHours(12, 0, 0, 0)
  return dt
}

function getWeekRange(ws) {
  const d = new Date(ws)
  const end = new Date(d)
  end.setDate(d.getDate() + 6)
  return { start: localDateStr(d), end: localDateStr(end) }
}

function getMonthRange(m) {
  const start = new Date(m.getFullYear(), m.getMonth(), 1)
  const end = new Date(m.getFullYear(), m.getMonth() + 1, 0)
  return { start: localDateStr(start), end: localDateStr(end) }
}

export default function Dashboard() {
  const navigate = useNavigate()
  const today = localDateStr(new Date())
  const [view, setView] = useState('week')
  const [selectedDate, setSelectedDate] = useState(today)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))
  const [month, setMonth] = useState(() => {
    const d = new Date()
    return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const { start, end } = view === 'week' ? getWeekRange(weekStart) : getMonthRange(month)

  const { data: goals = [], isLoading: goalsLoading } = useQuery({
    queryKey: ['goals'],
    queryFn: () => api.get('/api/goals').then(r => r.data),
  })

  const { data: days = [] } = useQuery({
    queryKey: ['plan-days', start, end],
    queryFn: () => api.get('/api/plans/days', { params: { start, end } }).then(r => r.data),
    enabled: goals.length > 0,
  })

  const { data: nutrition } = useQuery({
    queryKey: ['nutrition-targets', selectedDate],
    queryFn: () => api.get('/api/nutrition/targets', { params: { date: selectedDate } }).then(r => r.data),
    enabled: goals.length > 0,
  })

  const { data: profile = {} } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get('/api/profile').then(r => r.data),
  })

  const selectedDay = days.find(d => d.date === selectedDate) || { date: selectedDate, day_type: 'rest', workouts: [] }
  const badge = DAY_TYPE_BADGE[selectedDay.day_type] || DAY_TYPE_BADGE.rest

  if (goals.length === 0 && !goalsLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
        <div className="text-6xl mb-4">🏁</div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Welcome to Training Plans</h1>
        <p className="text-gray-500 mb-6">Set your first goal to generate a personalized training plan.</p>
        <button
          onClick={() => navigate('/onboarding')}
          className="bg-primary-600 text-white px-8 py-3 rounded-xl font-semibold text-lg active:bg-primary-700"
        >
          Get Started
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      {/* Header */}
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold">Training Plan</h1>
            {selectedDay.block_type && (
              <p className="text-primary-200 text-sm capitalize">{selectedDay.block_type} block</p>
            )}
          </div>
          {/* Week / Month toggle */}
          <div className="flex bg-primary-700 rounded-lg p-0.5">
            {['week', 'month'].map(v => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all capitalize
                  ${view === v ? 'bg-white text-primary-600 shadow-sm' : 'text-primary-200 active:text-white'}`}
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="px-4 -mt-2 space-y-4">
        {/* Calendar */}
        {view === 'week' ? (
          <WeekView
            days={days}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            onWeekChange={setWeekStart}
          />
        ) : (
          <MonthView
            days={days}
            selectedDate={selectedDate}
            onSelectDate={setSelectedDate}
            month={month}
            onMonthChange={setMonth}
          />
        )}

        {/* HR Zone strip */}
        <HRZoneStrip maxHr={profile?.max_hr} />

        {/* Selected day detail */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="font-semibold text-gray-900">
                {new Date(selectedDate + 'T00:00:00').toLocaleDateString('en-GB', {
                  weekday: 'long', month: 'long', day: 'numeric'
                })}
              </h2>
              <span className={`inline-block text-xs px-2 py-0.5 rounded-full font-medium mt-1 ${badge.bg}`}>
                {badge.label}
              </span>
            </div>
            {selectedDay.day_type !== 'rest' && (
              <button
                onClick={() => navigate(`/ai-coach?date=${selectedDate}&day_type=${selectedDay.day_type}`)}
                className="flex items-center gap-1 text-xs bg-primary-50 text-primary-600 px-3 py-1.5 rounded-full font-medium active:bg-primary-100"
              >
                🤖 AI Adjust
              </button>
            )}
          </div>

          {selectedDay.workouts && selectedDay.workouts.length > 0 ? (
            <div className="space-y-3">
              {selectedDay.workouts.map((w) => (
                <WorkoutCard key={w.id} workout={w} />
              ))}
            </div>
          ) : (
            <div className="text-center py-6 text-gray-400">
              <div className="text-3xl mb-2">💤</div>
              <p className="text-sm">Rest day — recover and recharge</p>
            </div>
          )}
        </div>

        {/* Nutrition summary */}
        {nutrition && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-gray-900">Nutrition Target</h3>
              <button onClick={() => navigate('/nutrition')} className="text-xs text-primary-600 font-medium">
                Log food →
              </button>
            </div>
            <div className="text-center mb-3">
              <span className="text-3xl font-bold text-gray-900">{nutrition.calories_kcal?.toLocaleString()}</span>
              <span className="text-gray-500 text-sm ml-1">kcal</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Protein', value: nutrition.protein_g, color: 'text-orange-600' },
                { label: 'Carbs',   value: nutrition.carbs_g,   color: 'text-blue-600' },
                { label: 'Fat',     value: nutrition.fat_g,      color: 'text-yellow-600' },
              ].map(m => (
                <div key={m.label} className="text-center">
                  <p className={`text-lg font-bold ${m.color}`}>
                    {Math.round(m.value)}<span className="text-xs font-normal text-gray-400">g</span>
                  </p>
                  <p className="text-xs text-gray-500">{m.label}</p>
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
