import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
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

// ---------------------------------------------------------------------------
// Load interpretation helpers
// ---------------------------------------------------------------------------

function ctlTier(ctl) {
  if (ctl < 15) return { label: 'Just starting — very low training base',      color: 'text-gray-600',   bg: 'bg-gray-50'   }
  if (ctl < 30) return { label: 'Building foundation — beginner training load', color: 'text-sky-600',    bg: 'bg-sky-50'    }
  if (ctl < 50) return { label: 'Solid base — recreational endurance athlete',  color: 'text-blue-600',   bg: 'bg-blue-50'   }
  if (ctl < 70) return { label: 'Well-trained — strong competitive level',      color: 'text-indigo-600', bg: 'bg-indigo-50' }
  if (ctl < 90) return { label: 'High performance — serious competitor',        color: 'text-purple-600', bg: 'bg-purple-50' }
  return         { label: 'Elite level — very high chronic load',               color: 'text-purple-800', bg: 'bg-purple-100'}
}

function atlTier(atl, ctl) {
  if (!ctl || ctl === 0) return { label: 'No fitness baseline yet — log more workouts', color: 'text-gray-500', bg: 'bg-gray-50' }
  const ratio = atl / ctl
  const pct   = Math.round(Math.abs(ratio - 1) * 100)
  if (ratio < 0.70) return { label: `${pct}% below fitness — undertraining / detraining risk`,   color: 'text-sky-600',    bg: 'bg-sky-50'    }
  if (ratio < 0.90) return { label: 'Light load — recovery or taper mode',                        color: 'text-green-600',  bg: 'bg-green-50'  }
  if (ratio < 1.10) return { label: 'Balanced — productive adaptation zone',                      color: 'text-green-600',  bg: 'bg-green-50'  }
  if (ratio < 1.30) return { label: `${pct}% above fitness — normal build phase`,                 color: 'text-yellow-700', bg: 'bg-yellow-50' }
  if (ratio < 1.55) return { label: `${pct}% above fitness — high load, monitor closely`,         color: 'text-orange-600', bg: 'bg-orange-50' }
  return              { label: `${pct}% above fitness — overreaching risk, reduce load now`,       color: 'text-red-600',    bg: 'bg-red-50'    }
}

function tsbTier(tsb) {
  if (tsb >  25) return { label: 'Very fresh — fitness may decondition if prolonged', color: 'text-sky-600',    bg: 'bg-sky-50'    }
  if (tsb >   5) return { label: 'Race-ready — optimal performance window',           color: 'text-green-600',  bg: 'bg-green-50'  }
  if (tsb >  -10) return { label: 'Productive fatigue — normal adaptation',           color: 'text-gray-600',   bg: 'bg-gray-50'   }
  if (tsb > -20) return { label: 'Accumulated fatigue — plan a recovery day soon',   color: 'text-orange-600', bg: 'bg-orange-50' }
  return          { label: 'Overreaching risk — reduce training load immediately',    color: 'text-red-600',    bg: 'bg-red-50'    }
}

function loadSummary(ctl, atl, tsb) {
  const ratio = ctl > 0 ? atl / ctl : null
  if (tsb < -20)
    return { text: 'Your fatigue is far exceeding your fitness base. This is the overreaching zone — injury and illness risk is elevated. Take 2–4 easy days before resuming hard training.', warnings: 'persistent soreness, elevated resting HR, poor sleep, low motivation', urgency: 'red' }
  if (tsb < -10 && ratio > 1.3)
    return { text: 'You are accumulating meaningful fatigue. This is expected during a build phase but requires monitoring. Plan 1–2 recovery sessions before your next hard block.', warnings: 'unusual muscle soreness, heavier than normal legs, disrupted sleep', urgency: 'orange' }
  if (tsb < -10)
    return { text: 'Solid training load with moderate fatigue accumulation. Your fitness base is absorbing the stress well. Prioritise sleep and nutrition to maximise adaptation.', warnings: null, urgency: 'yellow' }
  if (tsb > 25)
    return { text: 'You are very fresh — good for race day but if you are not tapering, consider adding a stimulus session. Prolonged freshness can reverse fitness gains.', warnings: null, urgency: 'blue' }
  if (tsb > 5)
    return { text: 'Excellent form. Your body has absorbed recent training and you are primed for performance. Ideal window for a key workout, race simulation, or event.', warnings: null, urgency: 'green' }
  return { text: 'Normal productive training load. Your fitness and fatigue are in balance — the ideal zone for consistent adaptation. Keep the pattern, respect your rest days.', warnings: null, urgency: 'green' }
}

function LoadInterpretation({ ctl, atl, tsb }) {
  const navigate = useNavigate()
  const c = ctlTier(ctl)
  const a = atlTier(atl, ctl)
  const f = tsbTier(tsb)
  const s = loadSummary(ctl, atl, tsb)

  const urgencyBorder = {
    red: 'border-red-200 bg-red-50', orange: 'border-orange-200 bg-orange-50',
    yellow: 'border-yellow-200 bg-yellow-50', blue: 'border-sky-200 bg-sky-50',
    green: 'border-green-200 bg-green-50',
  }[s.urgency] || 'border-gray-100 bg-gray-50'

  function askCoach() {
    const ratio = ctl > 0 ? (atl / ctl).toFixed(2) : 'N/A'
    const prompt = `My current training load: Fitness (CTL) = ${Math.round(ctl)}, Fatigue (ATL) = ${Math.round(atl)}, Form (TSB) = ${Math.round(tsb)}. ATL/CTL ratio = ${ratio}. Can you explain what this means for my training right now, and what I should focus on this week?`
    navigate(`/ai-coach?prompt=${encodeURIComponent(prompt)}`)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 text-sm">What your numbers mean for you</h3>
        <p className="text-[11px] text-gray-400 mt-0.5">Interpretation is relative to your own baseline — not global averages</p>
      </div>

      {/* Metric rows */}
      <div className="divide-y divide-gray-50">
        {[
          { metric: 'Fitness (CTL)', value: Math.round(ctl), tier: c, hint: '42-day avg load' },
          { metric: 'Fatigue (ATL)', value: Math.round(atl), tier: a, hint: '7-day avg load' },
          { metric: 'Form (TSB)',    value: Math.round(tsb), tier: f, hint: 'CTL minus ATL'   },
        ].map(({ metric, value, tier, hint }) => (
          <div key={metric} className="flex items-center gap-3 px-4 py-3">
            <div className="w-28 shrink-0">
              <p className="text-xs font-semibold text-gray-700">{metric}</p>
              <p className="text-[10px] text-gray-400">{hint}</p>
            </div>
            <div className={`text-lg font-bold ${tier.color} w-12 shrink-0 text-center`}>{value}</div>
            <div className={`flex-1 text-xs px-2.5 py-1.5 rounded-xl leading-snug ${tier.color} ${tier.bg}`}>
              {tier.label}
            </div>
          </div>
        ))}
      </div>

      {/* Summary */}
      <div className={`mx-4 mb-3 mt-1 rounded-xl border px-3 py-2.5 ${urgencyBorder}`}>
        <p className="text-xs text-gray-700 leading-relaxed">{s.text}</p>
        {s.warnings && (
          <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
            <span className="font-semibold">Watch for: </span>{s.warnings}
          </p>
        )}
      </div>

      {/* Ask Coach */}
      <div className="px-4 pb-4">
        <button
          onClick={askCoach}
          className="w-full flex items-center justify-center gap-2 bg-primary-600 text-white rounded-xl py-2.5 text-sm font-semibold active:bg-primary-700 transition-colors"
        >
          <span>🤖</span>
          Ask Coach About My Load
        </button>
      </div>
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

            {/* Personalised interpretation */}
            {latest && (
              <LoadInterpretation
                ctl={latest.ctl || 0}
                atl={latest.atl || 0}
                tsb={latest.tsb || 0}
              />
            )}

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
