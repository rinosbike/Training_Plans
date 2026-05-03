import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useMutation } from '@tanstack/react-query'
import api from '../services/api'
import toast from 'react-hot-toast'

const GOALS = [
  { type: 'marathon',        label: 'Marathon',        icon: '🏃', desc: '42.2 km run' },
  { type: 'half_marathon',   label: 'Half Marathon',   icon: '🏃', desc: '21.1 km run' },
  { type: '10k',             label: '10K',             icon: '🏃', desc: '10 km run' },
  { type: '5k',              label: '5K',              icon: '🏃', desc: '5 km run' },
  { type: 'ironman',         label: 'Ironman',         icon: '🏊🚴🏃', desc: '3.8+180+42.2 km' },
  { type: 'half_ironman',    label: 'Half Ironman',    icon: '🏊🚴🏃', desc: '1.9+90+21.1 km' },
  { type: 'sprint_triathlon',label: 'Sprint Tri',      icon: '🏊🚴🏃', desc: '0.75+20+5 km' },
  { type: 'cycling_event',   label: 'Cycling Event',   icon: '🚴', desc: 'Road or gravel' },
  { type: 'strength',        label: 'Strength',        icon: '🏋️', desc: 'Weight training' },
  { type: 'general_fitness', label: 'General Fitness', icon: '💪', desc: 'Stay active' },
]

export default function Onboarding() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1)
  const [profile, setProfile] = useState({ weight_kg: '', height_cm: '', gender: 'male', fitness_level: 'beginner', current_weekly_hours: '' })
  const [goal, setGoal] = useState({ goal_type: '', goal_name: '', target_date: '', event_name: '' })

  const saveProfile = useMutation({ mutationFn: (d) => api.put('/api/profile', d) })
  const createGoal = useMutation({ mutationFn: (d) => api.post('/api/goals', d) })
  const generatePlan = useMutation({ mutationFn: (d) => api.post('/api/plans/generate', d) })

  async function finish() {
    try {
      await saveProfile.mutateAsync(profile)
      const g = await createGoal.mutateAsync(goal)
      await generatePlan.mutateAsync({ goal_id: g.data.id })
      toast.success('Your training plan is ready!')
      navigate('/')
    } catch {
      toast.error('Something went wrong. Please try again.')
    }
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Progress */}
      <div className="bg-primary-600 px-4 pt-12 pb-6">
        <div className="flex gap-1 mb-4">
          {[1,2,3].map(s => (
            <div key={s} className={`flex-1 h-1 rounded-full ${s <= step ? 'bg-white' : 'bg-primary-400'}`} />
          ))}
        </div>
        <h1 className="text-white text-xl font-bold">
          {step === 1 ? 'Your Profile' : step === 2 ? 'Choose Your Goal' : 'Goal Details'}
        </h1>
        <p className="text-primary-200 text-sm">Step {step} of 3</p>
      </div>

      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {step === 1 && (
          <>
            <Field label="Weight (kg)" type="number" value={profile.weight_kg} onChange={v => setProfile(p => ({...p, weight_kg: v}))} placeholder="70" />
            <Field label="Height (cm)" type="number" value={profile.height_cm} onChange={v => setProfile(p => ({...p, height_cm: v}))} placeholder="175" />
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Gender</label>
              <div className="flex gap-2">
                {['male','female','other'].map(g => (
                  <button key={g} onClick={() => setProfile(p => ({...p, gender: g}))}
                    className={`flex-1 py-2 rounded-xl text-sm font-medium capitalize border ${profile.gender===g ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-200'}`}>
                    {g}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Fitness Level</label>
              <div className="grid grid-cols-2 gap-2">
                {['beginner','intermediate','advanced','elite'].map(l => (
                  <button key={l} onClick={() => setProfile(p => ({...p, fitness_level: l}))}
                    className={`py-2 rounded-xl text-sm font-medium capitalize border ${profile.fitness_level===l ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-200'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            <Field label="Current weekly training hours" type="number" value={profile.current_weekly_hours} onChange={v => setProfile(p => ({...p, current_weekly_hours: v}))} placeholder="5" />
          </>
        )}

        {step === 2 && (
          <div className="grid grid-cols-2 gap-3">
            {GOALS.map(g => (
              <button key={g.type} onClick={() => { setGoal(p => ({...p, goal_type: g.type, goal_name: g.label})); setStep(3) }}
                className={`p-4 rounded-2xl border-2 text-left transition-all ${goal.goal_type===g.type ? 'border-primary-600 bg-primary-50' : 'border-gray-200 bg-white'}`}>
                <div className="text-2xl mb-1">{g.icon}</div>
                <p className="font-semibold text-gray-900 text-sm">{g.label}</p>
                <p className="text-xs text-gray-500">{g.desc}</p>
              </button>
            ))}
          </div>
        )}

        {step === 3 && (
          <>
            <Field label="Goal Name" value={goal.goal_name} onChange={v => setGoal(p => ({...p, goal_name: v}))} placeholder="e.g. Berlin Marathon 2026" />
            <Field label="Target / Race Date" type="date" value={goal.target_date} onChange={v => setGoal(p => ({...p, target_date: v}))} />
            <Field label="Event Name (optional)" value={goal.event_name} onChange={v => setGoal(p => ({...p, event_name: v}))} placeholder="e.g. Berlin Marathon" />
          </>
        )}
      </div>

      {/* Nav buttons */}
      <div className="p-4 bg-white border-t border-gray-100 flex gap-3 safe-bottom">
        {step > 1 && (
          <button onClick={() => setStep(s => s - 1)} className="flex-1 py-3 rounded-xl border border-gray-300 font-semibold text-gray-700">
            Back
          </button>
        )}
        {step < 3 && step !== 2 && (
          <button onClick={() => setStep(s => s + 1)} className="flex-1 py-3 rounded-xl bg-primary-600 text-white font-semibold active:bg-primary-700">
            Next
          </button>
        )}
        {step === 3 && (
          <button onClick={finish} disabled={!goal.target_date || generatePlan.isPending}
            className="flex-1 py-3 rounded-xl bg-primary-600 text-white font-semibold active:bg-primary-700 disabled:opacity-50">
            {generatePlan.isPending ? 'Generating plan...' : 'Generate My Plan'}
          </button>
        )}
      </div>
    </div>
  )
}

function Field({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full border border-gray-300 rounded-xl px-4 py-3 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white"
      />
    </div>
  )
}
