import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import api from '../services/api'
import BottomNav from '../components/BottomNav'
import WeekView from '../components/calendar/WeekView'
import WorkoutCard from '../components/workout/WorkoutCard'

const DAY_TYPE_BADGE = {
  rest:     { label: 'Rest',     bg: 'bg-gray-100 text-gray-500' },
  easy:     { label: 'Easy',     bg: 'bg-green-100 text-green-700' },
  tempo:    { label: 'Tempo',    bg: 'bg-yellow-100 text-yellow-700' },
  interval: { label: 'Intervals',bg: 'bg-orange-100 text-orange-700' },
  long:     { label: 'Long',     bg: 'bg-blue-100 text-blue-700' },
  race:     { label: 'Race',     bg: 'bg-red-100 text-red-700' },
  strength: { label: 'Strength', bg: 'bg-purple-100 text-purple-700' },
  brick:    { label: 'Brick',    bg: 'bg-amber-100 text-amber-700' },
  core:     { label: 'Core',     bg: 'bg-pink-100 text-pink-700' },
}

function getWeekRange(weekStart) {
  const d = new Date(weekStart)
  const end = new Date(d)
  end.setDate(end.getDate() + 6)
  return {
    start: d.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  }
}

function startOfWeek(d) {
  const dt = new Date(d)
  const day = dt.getDay()
  const diff = day === 0 ? -6 : 1 - day
  dt.setDate(dt.getDate() + diff)
  dt.setHours(0,0,0,0)
  return dt
}

export default function Dashboard() {
  const navigate = useNavigate()
  const today = new Date().toISOString().split('T')[0]
  const [selectedDate, setSelectedDate] = useState(today)
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()))

  const { start, end } = getWeekRange(weekStart)

  // Fetch goals to check if onboarding needed
  const { data: goals = [] } = useQuery({
    queryKey: ['goals'],
    queryFn: () => api.get('/api/goals').then(r => r.data),
  })

  // Fetch plan days for current week
  const { data: days = [], isLoading } = useQuery({
    queryKey: ['plan-days', start, end],
    queryFn: () => api.get('/api/plans/days', { params: { start, end } }).then(r => r.data),
    enabled: goals.length > 0,
  })

  // Fetch nutrition targets for selected date
  const { data: nutrition } = useQuery({
    queryKey: ['nutrition-targets', selectedDate],
    queryFn: () => api.get('/api/nutrition/targets', { params: { date: selectedDate } }).then(r => r.data),
    enabled: goals.length > 0,
  })

  const selectedDay = days.find(d => d.date === selectedDate) || {
    date: selectedDate, day_type: 'rest', workouts: []
  }
  const badge = DAY_TYPE_BADGE[selectedDay.day_type] || DAY_TYPE_BADGE.rest

  if (goals.length === 0 && !isLoading) {
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
        <h1 className="text-xl font-bold">Training Plan</h1>
        {selectedDay.block_type && (
          <p className="text-primary-200 text-sm capitalize">{selectedDay.block_type} block</p>
        )}
      </div>

      <div className="px-4 -mt-2 space-y-4">
        {/* Week calendar */}
        <WeekView
          days={days}
          selectedDate={selectedDate}
          onSelectDate={setSelectedDate}
          onWeekChange={setWeekStart}
        />

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
              <button
                onClick={() => navigate('/nutrition')}
                className="text-xs text-primary-600 font-medium"
              >
                Log food →
              </button>
            </div>
            <div className="text-center mb-3">
              <span className="text-3xl font-bold text-gray-900">{nutrition.calories_kcal?.toLocaleString()}</span>
              <span className="text-gray-500 text-sm ml-1">kcal</span>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[
                { label: 'Protein', value: nutrition.protein_g, unit: 'g', color: 'text-orange-600' },
                { label: 'Carbs',   value: nutrition.carbs_g,   unit: 'g', color: 'text-blue-600' },
                { label: 'Fat',     value: nutrition.fat_g,     unit: 'g', color: 'text-yellow-600' },
              ].map(m => (
                <div key={m.label} className="text-center">
                  <p className={`text-lg font-bold ${m.color}`}>{Math.round(m.value)}<span className="text-xs font-normal text-gray-400">{m.unit}</span></p>
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
