import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'

function localDateStr(d) {
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-')
}

function Bar({ actual, target, color = 'bg-primary-500' }) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0
  const over = actual > target
  return (
    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${over ? 'bg-red-400' : color}`} style={{ width: `${pct}%` }} />
    </div>
  )
}

function MacroRow({ label, actual, target, unit, color, barColor }) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0
  return (
    <div>
      <div className="flex items-baseline justify-between mb-1">
        <span className={`text-sm font-medium ${color}`}>{label}</span>
        <span className="text-xs text-gray-500">
          <span className="font-semibold text-gray-800">{Math.round(actual)}</span>
          {' / '}{Math.round(target)}{unit}
          <span className="ml-1 text-gray-400">({pct}%)</span>
        </span>
      </div>
      <Bar actual={actual} target={target} color={barColor} />
    </div>
  )
}

function MicroRow({ label, actual, target, unit, color = 'bg-teal-400' }) {
  const pct = target > 0 ? Math.min(100, Math.round((actual / target) * 100)) : 0
  const over = actual > target
  return (
    <div className="flex items-center gap-3">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline justify-between mb-0.5">
          <span className="text-xs text-gray-600">{label}</span>
          <span className="text-xs text-gray-500">
            <span className={`font-medium ${over ? 'text-red-500' : 'text-gray-800'}`}>{actual > 0 ? actual.toFixed(actual < 10 ? 1 : 0) : '—'}</span>
            {' / '}{target}{unit}
          </span>
        </div>
        <Bar actual={actual} target={target} color={color} />
      </div>
      <span className={`text-xs font-medium w-8 text-right ${over ? 'text-red-500' : pct >= 80 ? 'text-green-600' : 'text-gray-400'}`}>
        {pct}%
      </span>
    </div>
  )
}

function FormulaCard({ formula, calories }) {
  const { t } = useTranslation('nutrition')
  const [open, setOpen] = useState(false)
  if (!formula) return null
  const { bmr_kcal, neat_kcal, eee_kcal, epoc_kcal,
          weight_kg, protein_g_per_kg, carb_g_per_kg, fat_g_per_kg,
          workouts_min, max_zone } = formula

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="text-sm font-semibold text-gray-700">{t('formula')}</span>
        <span className="text-gray-400 text-lg">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">
          {/* Calorie formula */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('calorieFormula')}</p>
            <div className="space-y-1.5 font-mono text-xs">
              <div className="flex justify-between text-gray-600">
                <span>BMR (Mifflin-St Jeor)</span>
                <span className="font-semibold">{bmr_kcal} kcal</span>
              </div>
              <div className="flex justify-between text-gray-600">
                <span>× 1.30 NEAT (daily life activity)</span>
                <span className="font-semibold">{neat_kcal} kcal</span>
              </div>
              {eee_kcal > 0 && (
                <div className="flex justify-between text-blue-600">
                  <span>+ EEE (MET × {weight_kg}kg × {workouts_min}min exercise)</span>
                  <span className="font-semibold">+{eee_kcal} kcal</span>
                </div>
              )}
              {epoc_kcal > 0 && (
                <div className="flex justify-between text-purple-600">
                  <span>+ EPOC (post-exercise, Z{max_zone} session)</span>
                  <span className="font-semibold">+{epoc_kcal} kcal</span>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-200 pt-1.5 font-semibold text-gray-900">
                <span>= Total TDEE</span>
                <span>{calories} kcal</span>
              </div>
            </div>
          </div>

          {/* Macro formula */}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('macroFormula')}</p>
            <div className="space-y-1 text-xs text-gray-600">
              <div className="flex justify-between">
                <span>Protein: {protein_g_per_kg} g/kg × {weight_kg} kg</span>
                <span className="font-medium text-orange-600">{Math.round(protein_g_per_kg * weight_kg)} g</span>
              </div>
              <div className="flex justify-between">
                <span>Carbs: {carb_g_per_kg} g/kg × {weight_kg} kg</span>
                <span className="font-medium text-blue-600">{Math.round(carb_g_per_kg * weight_kg)} g</span>
              </div>
              <div className="flex justify-between">
                <span>Fat: residual calories ÷ 9 (min 1.0 g/kg)</span>
                <span className="font-medium text-yellow-600">{Math.round(fat_g_per_kg * weight_kg)} g</span>
              </div>
            </div>
          </div>

          {/* MET reference */}
          {eee_kcal > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('metValues')}</p>
              <p className="text-xs text-gray-500 leading-relaxed">{t('metDesc')}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const MEALS = ['breakfast','lunch','dinner','snack','pre_workout','post_workout']

export default function Nutrition() {
  const { t } = useTranslation('nutrition')
  const [date, setDate] = useState(localDateStr(new Date()))
  const [search, setSearch] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [selected, setSelected] = useState(null)
  const [amount, setAmount] = useState('100')
  const [meal, setMeal] = useState('lunch')
  const qc = useQueryClient()

  const { data: logData } = useQuery({
    queryKey: ['food-log', date],
    queryFn: () => api.get('/api/food/log', { params: { date } }).then(r => r.data),
  })
  const { data: targets } = useQuery({
    queryKey: ['nutrition-targets', date],
    queryFn: () => api.get('/api/nutrition/targets', { params: { date } }).then(r => r.data),
  })

  const addFood = useMutation({
    mutationFn: (d) => api.post('/api/food/log', d),
    onSuccess: () => {
      qc.invalidateQueries(['food-log', date])
      setSelected(null); setSearch(''); setSearchResults([]); setAmount('100')
      toast.success(t('foodLogged'))
    },
  })
  const deleteFood = useMutation({
    mutationFn: (id) => api.delete(`/api/food/log/${id}`),
    onSuccess: () => qc.invalidateQueries(['food-log', date]),
  })

  async function doSearch(q) {
    setSearch(q)
    if (q.length < 2) { setSearchResults([]); return }
    const { data } = await api.get('/api/food/search', { params: { q } })
    setSearchResults(data)
  }

  const entries = logData?.entries || []
  const totals  = logData?.totals  || {}
  const tgt = targets || {}
  const f = tgt.formula || {}

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold">{t('title')}</h1>
        <p className="text-primary-200 text-sm mb-2">
          {targets?.formula?.workouts_min > 0
            ? t('trainingDay', { min: targets.formula.workouts_min, kcal: targets.calories_kcal?.toLocaleString() })
            : t('restDay')}
        </p>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="bg-primary-700 text-white rounded-lg px-3 py-1 text-sm border border-primary-500 w-full" />
      </div>

      <div className="px-4 mt-4 space-y-4">

        {/* Calories + macros */}
        {tgt.calories_kcal && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-3">
            <h2 className="font-semibold text-gray-900">{t('caloriesMacros')}</h2>

            {/* Calorie big number */}
            <div className="flex items-end gap-2 mb-1">
              <span className="text-3xl font-bold text-gray-900">{Math.round(totals.calories || 0).toLocaleString()}</span>
              <span className="text-gray-400 text-sm mb-1">/ {tgt.calories_kcal?.toLocaleString()} kcal</span>
              <span className="ml-auto text-xs text-gray-400">
                {tgt.calories_kcal - Math.round(totals.calories || 0) > 0
                  ? t('caloriesRemaining', { n: (tgt.calories_kcal - Math.round(totals.calories || 0)).toLocaleString() })
                  : t('targetReached')}
              </span>
            </div>
            <Bar actual={totals.calories || 0} target={tgt.calories_kcal} color="bg-gray-700" />

            <div className="space-y-2.5 pt-1">
              <MacroRow label={t('macros.protein')} actual={totals.protein_g||0} target={targets.protein_g} unit="g" color="text-orange-600" barColor="bg-orange-400" />
              <MacroRow label={t('macros.carbs')}   actual={totals.carbs_g||0}   target={targets.carbs_g}   unit="g" color="text-blue-600"   barColor="bg-blue-400" />
              <MacroRow label={t('macros.fat')}     actual={totals.fat_g||0}     target={targets.fat_g}     unit="g" color="text-yellow-600" barColor="bg-yellow-400" />
              <MacroRow label={t('macros.fiber')}   actual={totals.fiber_g||0}   target={targets.fiber_g}   unit="g" color="text-green-600"  barColor="bg-green-400" />
              <MacroRow label={t('macros.omega3')}  actual={0}                   target={targets.omega3_g}  unit="g" color="text-cyan-600"   barColor="bg-cyan-400" />
            </div>
          </div>
        )}

        {/* Electrolytes */}
        {tgt.sodium_mg && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2.5">
            <h2 className="font-semibold text-gray-900">{t('electrolytes')}</h2>
            <p className="text-xs text-gray-400 -mt-1">{t('electrolytesDesc')}</p>
            <MicroRow label={t('micros.sodium')}    actual={totals.sodium_mg||0}    target={targets.sodium_mg}    unit="mg" color="bg-amber-400" />
            <MicroRow label={t('micros.potassium')} actual={totals.potassium_mg||0} target={targets.potassium_mg} unit="mg" color="bg-lime-400" />
            <MicroRow label={t('micros.magnesium')} actual={totals.magnesium_mg||0} target={targets.magnesium_mg} unit="mg" color="bg-emerald-400" />
            <MicroRow label={t('micros.calcium')}   actual={totals.calcium_mg||0}   target={targets.calcium_mg}   unit="mg" color="bg-sky-400" />
          </div>
        )}

        {/* Vitamins & minerals */}
        {tgt.vitamin_d_mcg && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4 space-y-2.5">
            <h2 className="font-semibold text-gray-900">{t('vitamins')}</h2>
            <MicroRow label={t('micros.vitaminD')}   actual={totals.vitamin_d_mcg||0}   target={targets.vitamin_d_mcg}   unit="mcg" color="bg-yellow-400" />
            <MicroRow label={t('micros.vitaminC')}   actual={totals.vitamin_c_mg||0}    target={targets.vitamin_c_mg}    unit="mg"  color="bg-orange-400" />
            <MicroRow label={t('micros.vitaminB12')} actual={totals.vitamin_b12_mcg||0} target={targets.vitamin_b12_mcg} unit="mcg" color="bg-pink-400" />
            <MicroRow label={t('micros.iron')}       actual={totals.iron_mg||0}         target={targets.iron_mg}         unit="mg"  color="bg-red-400" />
            <MicroRow label={t('micros.zinc')}       actual={totals.zinc_mg||0}         target={targets.zinc_mg}         unit="mg"  color="bg-indigo-400" />
          </div>
        )}

        {/* Water & sleep */}
        {tgt.water_ml && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <h2 className="font-semibold text-gray-900 mb-3">{t('hydration')}</h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="text-center">
                <p className="text-2xl font-bold text-blue-600">{(tgt.water_ml / 1000).toFixed(1)}<span className="text-sm font-normal text-gray-400">L</span></p>
                <p className="text-xs text-gray-500">{t('waterTarget')}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t('waterHint')}</p>
              </div>
              <div className="text-center">
                <p className="text-2xl font-bold text-purple-600">{tgt.sleep_target_hours}<span className="text-sm font-normal text-gray-400">h</span></p>
                <p className="text-xs text-gray-500">{t('sleepTarget')}</p>
                <p className="text-xs text-gray-400 mt-0.5">{t('sleepHint')}</p>
              </div>
            </div>
          </div>
        )}

        {/* Formula breakdown */}
        <FormulaCard formula={f} calories={tgt.calories_kcal} />

        {/* Add food */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h2 className="font-semibold text-gray-900 mb-3">{t('addFood')}</h2>
          <div className="flex gap-1.5 flex-wrap mb-3">
            {MEALS.map(m => (
              <button key={m} onClick={() => setMeal(m)}
                className={`px-2 py-1 rounded-lg text-xs font-medium ${meal===m ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                {t(`meals.${m}`)}
              </button>
            ))}
          </div>
          <input value={search} onChange={e => doSearch(e.target.value)} placeholder={t('searchPlaceholder')}
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 mb-2" />
          {searchResults.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 mb-3">
              {searchResults.map(f => (
                <button key={f.id} onClick={() => { setSelected(f); setSearchResults([]); setSearch(f.name) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50 active:bg-gray-100">
                  <span className="font-medium">{f.name}</span>
                  <span className="text-gray-400 ml-2 text-xs">{f.calories_per_100g} kcal · {f.protein_per_100g}g P / {f.carbs_per_100g}g C / {f.fat_per_100g}g F per 100g</span>
                </button>
              ))}
            </div>
          )}
          {selected && (
            <div className="flex gap-2">
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)}
                className="w-24 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500" />
              <span className="self-center text-gray-500 text-sm">g</span>
              <button
                onClick={() => addFood.mutate({ food_id: selected.id, amount_g: parseFloat(amount), log_date: date, meal_type: meal })}
                disabled={addFood.isPending}
                className="flex-1 bg-primary-600 text-white rounded-xl py-2 text-sm font-medium active:bg-primary-700 disabled:opacity-50">
                {t('add')}
              </button>
            </div>
          )}
        </div>

        {/* Food log */}
        {entries.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <h2 className="font-semibold text-gray-900 mb-3">{t('todayLog')}</h2>
            <div className="space-y-2">
              {entries.map(e => (
                <div key={e.id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{e.food_name}</p>
                    <p className="text-xs text-gray-500">{e.amount_g}g · {Math.round(e.calories||0)} kcal · {e.protein_g?.toFixed(1)}g P · {e.meal_type.replace('_',' ')}</p>
                  </div>
                  <button onClick={() => deleteFood.mutate(e.id)} className="text-red-400 text-lg p-1">×</button>
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
