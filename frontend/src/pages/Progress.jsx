import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend, ReferenceLine } from 'recharts'
import api from '../services/api'
import BottomNav from '../components/BottomNav'

const ZONE_ROWS = [
  { z: 'Z1', factor: '0.55', tss: '~30'  },
  { z: 'Z2', factor: '0.75', tss: '~56'  },
  { z: 'Z3', factor: '0.90', tss: '~81'  },
  { z: 'Z4', factor: '1.05', tss: '~110' },
  { z: 'Z5', factor: '1.15', tss: '~132' },
]

const TSB_RANGES = [
  { range: '> +25',       key: 'tsbVeryFresh', bg: 'bg-blue-50  text-blue-800'   },
  { range: '+5 → +25',   key: 'tsbFresh',     bg: 'bg-green-50 text-green-800'  },
  { range: '−10 → +5',   key: 'tsbNormal',    bg: 'bg-gray-50  text-gray-700'   },
  { range: '−30 → −10',  key: 'tsbTired',     bg: 'bg-orange-50 text-orange-800'},
  { range: '< −30',       key: 'tsbRisk',      bg: 'bg-red-50   text-red-800'    },
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
              <p className="text-gray-800 font-semibold">TSS = (duration_min / 60) × 100 × zone_factor²</p>
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
// Load interpretation helpers — all labels come from i18n
// ---------------------------------------------------------------------------

// Visual style for each severity band
const S = {
  gray:   { color: 'text-gray-700',   border: 'border-gray-300',   bg: 'bg-gray-50',   pill: 'bg-gray-100 text-gray-700',     dot: 'bg-gray-400'   },
  sky:    { color: 'text-sky-700',    border: 'border-sky-400',    bg: 'bg-sky-50',    pill: 'bg-sky-100 text-sky-800',       dot: 'bg-sky-500'    },
  green:  { color: 'text-green-700',  border: 'border-green-400',  bg: 'bg-green-50',  pill: 'bg-green-100 text-green-800',   dot: 'bg-green-500'  },
  blue:   { color: 'text-blue-700',   border: 'border-blue-400',   bg: 'bg-blue-50',   pill: 'bg-blue-100 text-blue-800',     dot: 'bg-blue-500'   },
  indigo: { color: 'text-indigo-700', border: 'border-indigo-400', bg: 'bg-indigo-50', pill: 'bg-indigo-100 text-indigo-800', dot: 'bg-indigo-500' },
  purple: { color: 'text-purple-700', border: 'border-purple-500', bg: 'bg-purple-50', pill: 'bg-purple-100 text-purple-800', dot: 'bg-purple-500' },
  yellow: { color: 'text-yellow-800', border: 'border-yellow-400', bg: 'bg-yellow-50', pill: 'bg-yellow-100 text-yellow-800', dot: 'bg-yellow-500' },
  orange: { color: 'text-orange-700', border: 'border-orange-400', bg: 'bg-orange-50', pill: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500' },
  red:    { color: 'text-red-700',    border: 'border-red-500',    bg: 'bg-red-50',    pill: 'bg-red-100 text-red-800',       dot: 'bg-red-600'    },
}

function ctlTier(ctl, t) {
  if (ctl < 15) return { ...S.gray,   label: t('ctlTier1') }
  if (ctl < 30) return { ...S.sky,    label: t('ctlTier2') }
  if (ctl < 50) return { ...S.blue,   label: t('ctlTier3') }
  if (ctl < 70) return { ...S.indigo, label: t('ctlTier4') }
  if (ctl < 90) return { ...S.purple, label: t('ctlTier5') }
  return         { ...S.purple, label: t('ctlTier6'), pill: 'bg-purple-200 text-purple-900', dot: 'bg-purple-700' }
}

function atlTier(atl, ctl, t) {
  if (!ctl || ctl === 0) return { ...S.gray, label: t('atlNoBase') }
  const ratio = atl / ctl
  const pct   = Math.round(Math.abs(ratio - 1) * 100)
  if (ratio < 0.70) return { ...S.sky,    label: t('atlUnder',    { pct }) }
  if (ratio < 0.90) return { ...S.green,  label: t('atlLight')              }
  if (ratio < 1.10) return { ...S.green,  label: t('atlBalanced')           }
  if (ratio < 1.30) return { ...S.yellow, label: t('atlBuild',    { pct }) }
  if (ratio < 1.55) return { ...S.orange, label: t('atlHigh',     { pct }) }
  return              { ...S.red,    label: t('atlRisk',     { pct }) }
}

function tsbTier(tsb, t) {
  if (tsb >  25) return { ...S.sky,    label: t('tsbVeryFresh') }
  if (tsb >   5) return { ...S.green,  label: t('tsbFresh')     }
  if (tsb > -10) return { ...S.gray,   label: t('tsbNormal')    }
  if (tsb > -30) return { ...S.orange, label: t('tsbTired')     }
  return          { ...S.red,    label: t('tsbRisk')      }
}

function loadSummary(ctl, atl, tsb, t) {
  if (tsb < -30) return { text: t('summaryRed'),    warnings: t('warningRed'),    urgency: 'red'    }
  if (tsb < -20) return { text: t('summaryOrange'), warnings: t('warningOrange'), urgency: 'orange' }
  if (tsb < -10) return { text: t('summaryYellow'), warnings: null,               urgency: 'yellow' }
  if (tsb > 25)  return { text: t('summaryBlue'),   warnings: null,               urgency: 'blue'   }
  if (tsb > 5)   return { text: t('summaryFresh'),  warnings: null,               urgency: 'green'  }
  return                { text: t('summaryNormal'), warnings: null,               urgency: 'green'  }
}

function LoadInterpretation({ ctl, atl, tsb }) {
  const { t } = useTranslation('progress')
  const navigate = useNavigate()
  const c = ctlTier(ctl, t)
  const a = atlTier(atl, ctl, t)
  const f = tsbTier(tsb, t)
  const s = loadSummary(ctl, atl, tsb, t)

  const urgencyStyle = {
    red:    'border-red-300 bg-red-50',
    orange: 'border-orange-300 bg-orange-50',
    yellow: 'border-yellow-300 bg-yellow-50',
    blue:   'border-sky-300 bg-sky-50',
    green:  'border-green-300 bg-green-50',
  }[s.urgency] || 'border-gray-200 bg-gray-50'

  function askCoach() {
    const ratio = ctl > 0 ? (atl / ctl).toFixed(2) : 'N/A'
    const prompt = `My current training load: Fitness (CTL) = ${Math.round(ctl)}, Fatigue (ATL) = ${Math.round(atl)}, Form (TSB) = ${Math.round(tsb)}. ATL/CTL ratio = ${ratio}. Can you explain what this means for my training right now, and what I should focus on this week?`
    navigate(`/ai-coach?prompt=${encodeURIComponent(prompt)}`)
  }

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="font-semibold text-gray-900 text-sm">{t('interpTitle')}</h3>
        <p className="text-[11px] text-gray-400 mt-0.5">{t('interpSubtitle')}</p>
      </div>

      {/* Colour-coded metric rows */}
      <div className="divide-y divide-white">
        {[
          { metric: t('fitness'), value: Math.round(ctl), tier: c, hint: t('fitnessDesc') },
          { metric: t('fatigue'), value: Math.round(atl), tier: a, hint: t('fatigueDesc') },
          { metric: t('form'),    value: Math.round(tsb), tier: f, hint: t('formDesc')    },
        ].map(({ metric, value, tier, hint }) => (
          <div key={metric} className={`flex items-center gap-3 pl-0 pr-4 py-3 border-l-4 ${tier.border} ${tier.bg}`}>
            <div className="w-28 shrink-0 pl-4">
              <p className="text-xs font-semibold text-gray-800">{metric}</p>
              <p className="text-[10px] text-gray-500">{hint}</p>
            </div>
            <div className={`text-xl font-bold ${tier.color} w-10 shrink-0 text-center tabular-nums`}>{value}</div>
            <div className={`flex-1 flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg leading-snug font-medium ${tier.pill}`}>
              <span className={`w-2 h-2 rounded-full shrink-0 ${tier.dot}`} />
              {tier.label}
            </div>
          </div>
        ))}
      </div>

      {/* Contextual advice */}
      <div className={`mx-4 mb-3 mt-3 rounded-xl border px-3 py-2.5 ${urgencyStyle}`}>
        <p className="text-xs text-gray-700 leading-relaxed">{s.text}</p>
        {s.warnings && (
          <p className="text-[11px] text-gray-500 mt-1.5 leading-relaxed">
            <span className="font-semibold">{t('watchFor')} </span>{s.warnings}
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
          {t('askCoachLoad')}
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
    if (v > -30) return { text: 'text-orange-600',bg: 'bg-orange-50'}
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
