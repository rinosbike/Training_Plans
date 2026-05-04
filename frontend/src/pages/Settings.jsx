import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import { useAuth } from '../contexts/AuthContext'
import BottomNav from '../components/BottomNav'
import LanguageSwitcher from '../components/LanguageSwitcher'
import toast from 'react-hot-toast'

export default function Settings() {
  const { user, logout } = useAuth()
  const navigate = useNavigate()
  const { t } = useTranslation('settings')
  const qc = useQueryClient()

  const { data: profile = {} } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get('/api/profile').then(r => r.data),
  })
  const [form, setForm] = useState(null)
  const f = form || profile

  const saveProfile = useMutation({
    mutationFn: (d) => api.put('/api/profile', d),
    onSuccess: () => { qc.invalidateQueries(['profile']); toast.success(t('saved')) },
  })

  function set(key, val) {
    setForm(p => ({ ...p || profile, [key]: val }))
  }

  const FITNESS_LEVELS = ['beginner', 'intermediate', 'advanced', 'elite']

  return (
    <div className="min-h-screen bg-gray-50 pb-nav flex flex-col">
      {/* Compact header */}
      <div className="bg-primary-600 text-white px-4 pt-10 pb-3 relative">
        <div className="flex items-center gap-3">
          {user?.avatar_url
            ? <img src={user.avatar_url} className="w-10 h-10 rounded-full border-2 border-white/30" alt="" />
            : <div className="w-10 h-10 rounded-full bg-primary-400 flex items-center justify-center text-lg font-bold">{user?.name?.[0]}</div>
          }
          <div className="min-w-0">
            <p className="font-semibold text-white leading-tight truncate">{user?.name}</p>
            <p className="text-primary-200 text-xs truncate">{user?.email}</p>
          </div>
          {user?.is_admin && (
            <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-amber-400 text-amber-900 font-semibold shrink-0">Admin</span>
          )}
        </div>
        <div className="flex justify-end mt-2">
          <LanguageSwitcher />
        </div>
      </div>

      <div className="px-4 pt-3 space-y-3 flex-1">

        {/* Fitness level — compact pill row */}
        <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('fitnessLevel')}</p>
          <div className="grid grid-cols-4 gap-1.5">
            {FITNESS_LEVELS.map(l => (
              <button key={l} onClick={() => set('fitness_level', l)}
                className={`py-2 rounded-xl text-xs font-medium capitalize border transition-colors ${f.fitness_level === l ? 'bg-primary-600 text-white border-primary-600' : 'bg-white text-gray-600 border-gray-200'}`}>
                {t(`fitnessLevels.${l}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Profile fields — 2-column grid */}
        <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('profile')}</p>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            <Field label={t('fields.weight')}      value={f.weight_kg}             onChange={v => set('weight_kg', v)} />
            <Field label={t('fields.height')}      value={f.height_cm}             onChange={v => set('height_cm', v)} />
            <Field label={t('fields.restingHr')}   value={f.resting_hr}            onChange={v => set('resting_hr', v)} />
            <Field label={t('fields.maxHr')}       value={f.max_hr}                onChange={v => set('max_hr', v)}
              hint={t('fields.maxHrHint')} />
            <Field label={t('fields.ftp')}         value={f.ftp_watts}             onChange={v => set('ftp_watts', v)} />
            <Field label={t('fields.weeklyHours')} value={f.current_weekly_hours}  onChange={v => set('current_weekly_hours', v)} />
          </div>
          <button
            onClick={() => saveProfile.mutate(form || profile)}
            disabled={saveProfile.isPending}
            className="mt-3 w-full bg-primary-600 text-white py-2.5 rounded-xl text-sm font-semibold active:bg-primary-700 disabled:opacity-50"
          >
            {saveProfile.isPending ? '…' : t('saveProfile')}
          </button>
        </div>

        {/* Quick actions — compact list */}
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100">
          <NavRow label={t('nav.newGoal')}      icon="🎯" onClick={() => navigate('/onboarding')} />
          <NavRow label={t('nav.deviceSync')}   icon="📡" onClick={() => navigate('/sync')} />
          <NavRow label={t('nav.branding')}     icon="ℹ️" onClick={() => navigate('/branding')} />
          {user?.is_admin && <>
            <NavRow label={t('nav.credentials')}  icon="🔑" onClick={() => navigate('/credentials')} badge="Admin" />
            <NavRow label={t('nav.translations')} icon="🌐" onClick={() => navigate('/translations')} badge="Admin" />
          </>}
        </div>

        {/* Language selector (non-admin) */}
        {!user?.is_admin && (
          <div className="bg-white rounded-2xl border border-gray-100 px-4 py-3 flex items-center justify-between">
            <span className="text-sm font-medium text-gray-700">{t('nav.language')}</span>
            <LanguageSwitcher variant="light" />
          </div>
        )}

        {/* Sign out */}
        <button
          onClick={logout}
          className="w-full py-2.5 rounded-2xl border border-red-200 text-red-500 text-sm font-medium active:bg-red-50"
        >
          Sign Out
        </button>

      </div>
      <BottomNav />
    </div>
  )
}

function Field({ label, value, onChange, unit, hint }) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-0.5">
        {label}{unit && <span className="text-gray-400"> ({unit})</span>}
      </label>
      <input
        type="number"
        value={value || ''}
        onChange={e => onChange(e.target.value)}
        className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-400 bg-white"
      />
      {hint && <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{hint}</p>}
    </div>
  )
}

function NavRow({ label, icon, onClick, badge }) {
  return (
    <button onClick={onClick} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 active:bg-gray-100">
      <span className="text-lg w-6 text-center">{icon}</span>
      <span className="flex-1 text-sm font-medium text-gray-700">{label}</span>
      {badge && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-600 font-medium">{badge}</span>
      )}
      <span className="text-gray-300 text-sm">›</span>
    </button>
  )
}
