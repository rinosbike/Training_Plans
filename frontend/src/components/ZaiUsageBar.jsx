import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import api from '../services/api'

function Bar({ label, pct, reset }) {
  const { i18n } = useTranslation()
  const left = Math.max(0, 100 - Math.round(pct))
  const color = pct >= 95 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-500' : 'bg-primary-500'
  const resetText = reset
    ? new Date(reset).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })
    : null
  return (
    <div>
      <div className="flex justify-between text-xs text-gray-500">
        <span>{label}</span>
        <span>{left}%</span>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden mt-1">
        <div className={`h-full ${color}`} style={{ width: `${Math.min(100, Math.round(pct))}%` }} />
      </div>
      {resetText && <p className="text-[11px] text-gray-400 mt-0.5">{resetText}</p>}
    </div>
  )
}

// How much of the shared Z.ai plan quota is left; shown wherever an AI function is used.
export default function ZaiUsageBar() {
  const { t } = useTranslation('common')
  const { data } = useQuery({
    queryKey: ['zai-usage'],
    queryFn: () => api.get('/api/zai/usage').then(r => r.data.quota),
    refetchInterval: 60000,
  })
  if (!data) return null
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3 space-y-2">
      <p className="text-xs font-semibold text-gray-600">{t('zai.title')}</p>
      <div className="grid grid-cols-2 gap-4">
        <Bar label={t('zai.fiveHour')} pct={data.five_hour_pct} reset={data.five_hour_reset} />
        <Bar label={t('zai.weekly')} pct={data.weekly_pct} reset={data.weekly_reset} />
      </div>
      <p className="text-[11px] text-gray-400">{t('zai.left')}</p>
    </div>
  )
}
