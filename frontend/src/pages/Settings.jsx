import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'

export default function Settings() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: profile = {} } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get('/api/profile').then(r => r.data),
  })
  const [form, setForm] = useState(null)
  const f = form || profile

  const saveProfile = useMutation({
    mutationFn: (d) => api.put('/api/profile', d),
    onSuccess: () => { qc.invalidateQueries(['profile']); toast.success('Profile saved') },
  })

  const fields = [
    { key: 'weight_kg', label: 'Weight (kg)', type: 'number' },
    { key: 'height_cm', label: 'Height (cm)', type: 'number' },
    { key: 'resting_hr', label: 'Resting HR (bpm)', type: 'number' },
    { key: 'max_hr', label: 'Max HR (bpm)', type: 'number' },
    { key: 'ftp_watts', label: 'FTP (watts, cycling)', type: 'number' },
    { key: 'current_weekly_hours', label: 'Current weekly hours', type: 'number' },
  ]

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold">Settings</h1>
      </div>

      <div className="px-4 mt-4 space-y-4">
        {/* Profile */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <div className="flex items-center gap-3 mb-4">
            {user?.avatar_url && <img src={user.avatar_url} className="w-12 h-12 rounded-full" alt="" />}
            <div>
              <p className="font-semibold text-gray-900">{user?.name}</p>
              <p className="text-sm text-gray-500">{user?.email}</p>
            </div>
          </div>

          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Fitness Level</label>
              <div className="grid grid-cols-2 gap-2">
                {['beginner','intermediate','advanced','elite'].map(l => (
                  <button key={l} onClick={() => setForm(p => ({...p || profile, fitness_level: l}))}
                    className={`py-2 rounded-xl text-sm font-medium capitalize border ${f.fitness_level===l ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-700 border-gray-200'}`}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
            {fields.map(field => (
              <div key={field.key}>
                <label className="block text-sm font-medium text-gray-700 mb-1">{field.label}</label>
                <input type={field.type} value={f[field.key] || ''} onChange={e => setForm(p => ({...p || profile, [field.key]: e.target.value}))}
                  className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              </div>
            ))}
          </div>
          <button onClick={() => saveProfile.mutate(form || profile)} disabled={saveProfile.isPending}
            className="mt-4 w-full bg-primary-600 text-white py-3 rounded-xl font-medium active:bg-primary-700 disabled:opacity-50">
            {saveProfile.isPending ? 'Saving...' : 'Save Profile'}
          </button>
        </div>

        {/* Actions */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2">
          <button onClick={() => navigate('/onboarding')} className="w-full text-left py-2 text-sm text-gray-700 font-medium flex items-center justify-between">
            Set New Goal <span className="text-gray-400">›</span>
          </button>
          <button onClick={() => navigate('/sync')} className="w-full text-left py-2 text-sm text-gray-700 font-medium flex items-center justify-between">
            Device Sync <span className="text-gray-400">›</span>
          </button>
          <div className="border-t border-gray-100 pt-2 mt-1" />
          <button onClick={() => navigate('/credentials')} className="w-full text-left py-2 text-sm text-gray-700 font-medium flex items-center justify-between">
            API Credentials <span className="text-gray-400">›</span>
          </button>
          <button onClick={() => navigate('/branding')} className="w-full text-left py-2 text-sm text-gray-700 font-medium flex items-center justify-between">
            Branding &amp; App Info <span className="text-gray-400">›</span>
          </button>
        </div>

        <button onClick={logout} className="w-full py-3 rounded-2xl border border-red-300 text-red-600 font-medium active:bg-red-50">
          Sign Out
        </button>
      </div>

      <BottomNav />
    </div>
  )
}
