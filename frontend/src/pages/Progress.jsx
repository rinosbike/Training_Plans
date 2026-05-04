import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import api from '../services/api'
import BottomNav from '../components/BottomNav'

const ZONE_ROWS = [
  { z: 'Z1', factor: '0.55', tss: '~18' },
  { z: 'Z2', factor: '0.75', tss: '~34' },
  { z: 'Z3', factor: '0.90', tss: '~49' },
  { z: 'Z4', factor: '1.05', tss: '~66' },
  { z: 'Z5', factor: '1.15', tss: '~79' },
]

const TSB_RANGES = [
  { range: '> +25',       key: 'tsbVeryFresh', bg: 'bg-blue-50  text-blue-800'   },
  { range: '+5 → +25',   key: 'tsbFresh',     bg: 'bg-green-50 text-green-800'  },
  { range: '−10 → +5',   key: 'tsbNormal',    bg: 'bg-gray-50  text-gray-700'   },
  { range: '−20 → −10',  key: 'tsbTired',     bg: 'bg-orange-50 text-orange-800'},
  { range: '< −20',       key: 'tsbRisk',      bg: 'bg-red-50   text-red-800'    },
]

function LoadExplainer() {
  const { t } = useTranslation('progress')
  const [open, setOpen] = useState(false)

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-gray-700">{t('howCalculated')}</span>
        <span className="text-gray-400 text-base">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="border-t border-gray-100 px-4 pb-5 pt-3 space-y-5">

          {/* TSS */}
          <section>
            <p className="text-xs font-bold uppercase tracking-wide text-gray-500 mb-1.5">{t('tssTitle')}</p>
            <p className="text-xs text-gray-600 leading-relaxed mb-2">{t('tssDesc')}</p>
            <div className="bg-gray-50 rounded-xl p-3 font-mono text-xs space-y-2">
              <p className="text-gray-800 font-semibold">TSS = duration_min × zone_factor²</p>
              <div className="pt-1 space-y-1">
                {ZONE_ROWS.map(r => (
                  <div key={r.z} className="flex items-center gap-2 text-gray-600">
                    <span className="font-bold text-primary-600 w-6">{r.z}</span>
                    <span className="flex-1 text-gray-500">{t(`zoneLabel.${r.z.slice(1)}`)}</span>
                    <span className="text-gray-400 w-12 text-right">×{r.factor}</span>
                    <span className="text-gray-500 font-semibold w-16 text-right">{r.tss} TSS/h</span>
                  </div>
                ))}
              </div>
            </div>
          </section>

          {/* ATL */}
          <section>
            <p className="text-xs font-bold uppercase tracking-wide text-red-500 mb-1.5">{t('atlTitle')}</p>
            <p className="text-xs text-gray-600 leading-relaxed mb-2">{t('atlDesc')}</p>
            <div className="bg-red-50 rounded-xl p-3 font-mono text-xs space-y-1">
              <p className="text-red-800 font-semibold">{t('atlFormula')}</p>
              <p className="text-red-400">{t('atlDecay')}</p>
            </div>
          </section>

          {/* CTL */}
          <section>
            <p className="text-xs font-bold uppercase tracking-wide text-blue-500 mb-1.5">{t('ctlTitle')}</p>
            <p className="text-xs text-gray-600 leading-relaxed mb-2">{t('ctlDesc')}</p>
            <div className="bg-blue-50 rounded-xl p-3 font-mono text-xs space-y-1">
              <p className="text-blue-800 font-semibold">{t('ctlFormula')}</p>
              <p className="text-blue-400">{t('ctlDecay')}</p>
            </div>
          </section>

          {/* TSB */}
          <section>
            <p className="text-xs font-bold uppercase tracking-wide text-green-600 mb-1.5">{t('tsbTitle')}</p>
            <p className="text-xs text-gray-600 leading-relaxed mb-2">{t('tsbDesc')}</p>
            <div className="bg-green-50 rounded-xl p-3 font-mono text-xs mb-3">
              <p className="text-green-800 font-semibold">TSB = CTL − ATL</p>
            </div>
            <div className="space-y-1.5">
              {TSB_RANGES.map(r => (
                <div key={r.range} className={`flex items-start gap-3 px-3 py-2 rounded-xl text-xs ${r.bg}`}>
                  <span className="font-mono font-bold w-20 shrink-0 pt-px">{r.range}</span>
                  <span className="leading-snug">{t(r.key)}</span>
                </div>
              ))}
            </div>
          </section>

        </div>
      )}
    </div>
  )
}

export default function Progress() {
  const { t } = useTranslation('progress')
  const { data: load = [] } = useQuery({
    queryKey: ['training-load'],
    queryFn: () => api.get('/api/progress/load').then(r => r.data),
  })

  const chartData = load.map(d => ({
    date: d.date.slice(5),
    CTL: Math.round(d.ctl || 0),
    ATL: Math.round(d.atl || 0),
    Form: Math.round(d.tsb || 0),
  }))

  const latest = load.length > 0 ? load[load.length - 1] : null
  const tsb = latest ? Math.round(latest.tsb || 0) : null

  function tsbColor(v) {
    if (v === null) return { text: 'text-gray-600', bg: 'bg-gray-50' }
    if (v > 25)  return { text: 'text-blue-600',  bg: 'bg-blue-50'  }
    if (v > 5)   return { text: 'text-green-600', bg: 'bg-green-50' }
    if (v > -10) return { text: 'text-gray-600',  bg: 'bg-gray-50'  }
    if (v > -20) return { text: 'text-orange-600',bg: 'bg-orange-50'}
    return         { text: 'text-red-600',         bg: 'bg-red-50'   }
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <p className="text-primary-200 text-sm">{t('subtitle')}</p>
      </div>

      <div className="px-4 mt-4 space-y-4">
        {load.length > 0 ? (
          <>
            {/* Current value cards */}
            {latest && (
              <div className="grid grid-cols-3 gap-3">
                <MetricCard
                  label={t('fitness')}
                  value={Math.round(latest.ctl || 0)}
                  color="text-blue-600"
                  bg="bg-blue-50"
                  desc={t('fitnessDesc')}
                  sub={t('ctlSub')}
                />
                <MetricCard
                  label={t('fatigue')}
                  value={Math.round(latest.atl || 0)}
                  color="text-red-600"
                  bg="bg-red-50"
                  desc={t('fatigueDesc')}
                  sub={t('atlSub')}
                />
                <MetricCard
                  label={t('form')}
                  value={tsb}
                  color={tsbColor(tsb).text}
                  bg={tsbColor(tsb).bg}
                  desc={t('formDesc')}
                  sub={t('tsbSub')}
                />
              </div>
            )}

            {/* Chart */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <h2 className="font-semibold text-gray-900 mb-4">{t('last60')}</h2>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData.slice(-60)} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} interval={9} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} />
                  <ReferenceLine y={0} stroke="#d1d5db" strokeDasharray="3 3" />
                  <ReferenceLine y={5}  stroke="#22c55e" strokeDasharray="2 4" strokeOpacity={0.5} />
                  <ReferenceLine y={-20} stroke="#ef4444" strokeDasharray="2 4" strokeOpacity={0.5} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="CTL"  stroke="#3b82f6" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="ATL"  stroke="#ef4444" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="Form" stroke="#22c55e" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>

              {/* Color-coded form guide */}
              <div className="mt-3 space-y-1.5">
                {TSB_RANGES.map(r => (
                  <div key={r.range} className={`flex items-center gap-2.5 px-3 py-1.5 rounded-xl text-xs ${r.bg}`}>
                    <span className="font-mono font-bold w-20 shrink-0">{r.range}</span>
                    <span>{t(r.key)}</span>
                  </div>
                ))}
              </div>
            </div>

            {/* Explainer */}
            <LoadExplainer />
          </>
        ) : (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">📈</div>
            <p className="font-medium text-gray-600">{t('noData')}</p>
            <p className="text-sm">{t('noDataDesc')}</p>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}

function MetricCard({ label, value, color, bg, desc, sub }) {
  return (
    <div className={`${bg} rounded-2xl p-3 text-center`}>
      <p className={`text-2xl font-bold ${color}`}>{value ?? '—'}</p>
      <p className="text-xs font-semibold text-gray-700 mt-0.5">{label}</p>
      <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">{desc}</p>
      {sub && <p className="text-[10px] text-gray-400 mt-0.5 leading-tight">{sub}</p>}
    </div>
  )
}
