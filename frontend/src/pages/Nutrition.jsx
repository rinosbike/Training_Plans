import { useState, useRef, useCallback } from 'react'
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

function MacroRow({ label, actual, target, unit, color, barColor, formula }) {
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
      {formula && (
        <p className="text-[11px] text-gray-400 mt-0.5">{formula} = {Math.round(target)}{unit}</p>
      )}
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
  const [open, setOpen] = useState(true)
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

const NUTRIENT_LABEL_MAP = {
  calories_per_100g: { label: 'Energy', unit: 'kcal' },
  protein_per_100g:  { label: 'Protein', unit: 'g' },
  carbs_per_100g:    { label: 'Carbohydrates', unit: 'g' },
  fat_per_100g:      { label: 'Fat', unit: 'g' },
  fiber_per_100g:    { label: 'Fibre', unit: 'g' },
  sodium_per_100g:   { label: 'Sodium', unit: 'mg' },
  iron_per_100g:     { label: 'Iron', unit: 'mg' },
  calcium_per_100g:  { label: 'Calcium', unit: 'mg' },
  vitamin_d_per_100g:   { label: 'Vitamin D', unit: 'mcg' },
  vitamin_b12_per_100g: { label: 'Vitamin B12', unit: 'mcg' },
  vitamin_c_per_100g:   { label: 'Vitamin C', unit: 'mg' },
  magnesium_per_100g:   { label: 'Magnesium', unit: 'mg' },
  potassium_per_100g:   { label: 'Potassium', unit: 'mg' },
  zinc_per_100g:        { label: 'Zinc', unit: 'mg' },
}

function LabelScanner({ onApplyCorrection, t }) {
  const fileRef = useRef(null)
  const [scanning, setScanning] = useState(false)
  const [result, setResult] = useState(null)      // {food_name_guess, per_100g, warnings, ocr_text}
  const [edits, setEdits] = useState({})           // user-edited values
  const [foodName, setFoodName] = useState('')
  const [showOcr, setShowOcr] = useState(false)
  const [matchedFood, setMatchedFood] = useState(null)
  const [searchResults, setSearchResults] = useState([])

  async function handleFile(file) {
    if (!file) return
    setScanning(true)
    setResult(null)
    setEdits({})
    try {
      const fd = new FormData()
      fd.append('image', file)
      const { data } = await api.post('/api/ocr/food-label', fd)
      setResult(data)
      setFoodName(data.food_name_guess || '')
      // Pre-fill edits with detected values
      setEdits({ ...data.per_100g })
    } catch (err) {
      toast.error(t('ocrFailed'))
    } finally {
      setScanning(false)
    }
  }

  async function searchFood(q) {
    setFoodName(q)
    if (q.length < 2) { setSearchResults([]); return }
    const { data } = await api.get('/api/food/search', { params: { q } })
    setSearchResults(data)
  }

  function applyCorrection() {
    if (!matchedFood) { toast.error(t('ocrSelectFood')); return }
    const nutrients = Object.fromEntries(
      Object.entries(edits).filter(([, v]) => v !== '' && !isNaN(Number(v)))
        .map(([k, v]) => [k, Number(v)])
    )
    onApplyCorrection({ food_id: matchedFood.id, food_name: matchedFood.name, nutrients })
    setResult(null); setEdits({}); setMatchedFood(null); setFoodName('')
  }

  return (
    <div className="border border-dashed border-primary-300 rounded-xl p-3 bg-primary-50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-semibold text-primary-800">{t('ocrTitle')}</span>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={scanning}
          className="flex items-center gap-1.5 bg-primary-600 text-white text-xs font-medium px-3 py-1.5 rounded-lg active:bg-primary-700 disabled:opacity-50"
        >
          {scanning ? <span className="animate-spin">⟳</span> : '📷'}
          {scanning ? t('ocrScanning') : t('ocrScan')}
        </button>
        <input ref={fileRef} type="file" accept="image/*"
          className="hidden" onChange={e => handleFile(e.target.files[0])} />
      </div>
      <p className="text-xs text-primary-600">{t('ocrHint')}</p>

      {result && (
        <div className="mt-3 space-y-3">
          {/* Food name match */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1">{t('ocrMatchFood')}</p>
            <input
              value={foodName}
              onChange={e => searchFood(e.target.value)}
              placeholder={t('ocrFoodPlaceholder')}
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
            />
            {searchResults.length > 0 && (
              <div className="border border-gray-200 rounded-lg overflow-hidden divide-y divide-gray-100 mt-1">
                {searchResults.map(f => (
                  <button key={f.id}
                    onClick={() => { setMatchedFood(f); setFoodName(f.name); setSearchResults([]) }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-gray-50 ${matchedFood?.id === f.id ? 'bg-primary-50 font-semibold' : ''}`}
                  >
                    {f.name}
                    <span className="text-gray-400 ml-2">{Math.round(f.calories_per_100g)} kcal</span>
                  </button>
                ))}
              </div>
            )}
            {matchedFood && (
              <p className="text-xs text-green-700 mt-1">✓ {matchedFood.name}</p>
            )}
          </div>

          {/* Editable nutrient table */}
          <div>
            <p className="text-xs font-semibold text-gray-700 mb-1">{t('ocrReviewValues')}</p>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="text-left text-xs text-gray-500 font-semibold px-3 py-1.5">{t('labelNutrient')}</th>
                    <th className="text-right text-xs text-gray-500 font-semibold px-3 py-1.5">{t('ocrDetected')}</th>
                    <th className="text-right text-xs text-gray-500 font-semibold px-3 py-1.5">{t('ocrConfirm')}</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(NUTRIENT_LABEL_MAP).map(([col, { label, unit }]) => {
                    const detected = result.per_100g[col]
                    if (detected == null && edits[col] == null) return null
                    return (
                      <tr key={col} className="border-t border-gray-100">
                        <td className="px-3 py-1.5 text-xs text-gray-700">{label}</td>
                        <td className="px-3 py-1.5 text-xs text-right text-gray-400 tabular-nums">
                          {detected != null ? `${detected} ${unit}` : '—'}
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <input
                              type="number"
                              value={edits[col] ?? detected ?? ''}
                              onChange={e => setEdits(prev => ({ ...prev, [col]: e.target.value }))}
                              className="w-16 text-xs text-right border border-gray-300 rounded px-1.5 py-0.5 focus:outline-none focus:ring-1 focus:ring-primary-400"
                            />
                            <span className="text-xs text-gray-400 w-6">{unit}</span>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Warnings */}
          {result.warnings?.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <p className="text-xs font-semibold text-amber-800 mb-1">⚠ {t('ocrWarnings')}</p>
              {result.warnings.map((w, i) => (
                <p key={i} className="text-xs text-amber-700">• {w}</p>
              ))}
            </div>
          )}

          {/* OCR raw text (collapsible) */}
          <button onClick={() => setShowOcr(o => !o)} className="text-xs text-gray-400 underline">
            {showOcr ? t('ocrHideRaw') : t('ocrShowRaw')}
          </button>
          {showOcr && (
            <pre className="text-[10px] text-gray-500 bg-gray-100 rounded p-2 overflow-x-auto whitespace-pre-wrap max-h-32">
              {result.ocr_text}
            </pre>
          )}

          <button
            onClick={applyCorrection}
            disabled={!matchedFood}
            className="w-full bg-primary-600 text-white text-sm font-semibold py-2 rounded-xl active:bg-primary-700 disabled:opacity-40"
          >
            {t('ocrApply')}
          </button>
        </div>
      )}
    </div>
  )
}

const MEALS = ['breakfast','lunch','dinner','snack','pre_workout','post_workout']

const MEAL_COLORS = {
  breakfast: 'bg-amber-100 text-amber-700',
  lunch: 'bg-green-100 text-green-700',
  dinner: 'bg-blue-100 text-blue-700',
  snack: 'bg-purple-100 text-purple-700',
  pre_workout: 'bg-orange-100 text-orange-700',
  post_workout: 'bg-teal-100 text-teal-700',
}

function fmt(val, dec = 1) {
  if (val == null || val === 0) return '0'
  const n = Number(val)
  return n < 10 ? n.toFixed(dec) : Math.round(n).toString()
}

function LabelRow({ label, per100, forAmount, unit, highlight = false }) {
  return (
    <tr className={`border-t border-gray-100 ${highlight ? 'font-semibold' : ''}`}>
      <td className={`py-1.5 pr-3 text-xs text-gray-700 ${highlight ? 'font-semibold' : ''}`}>{label}</td>
      <td className="py-1.5 pr-3 text-xs text-gray-500 text-right tabular-nums">{fmt(per100)} {unit}</td>
      <td className={`py-1.5 text-xs text-right tabular-nums ${highlight ? 'text-gray-900 font-bold' : 'text-gray-700'}`}>{fmt(forAmount)} {unit}</td>
    </tr>
  )
}

function FoodEntry({ entry, onDelete, onUpdate, t }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(false)
  const [editVal, setEditVal] = useState(String(entry.amount_g))
  const inputRef = useRef(null)

  const amount = Number(entry.amount_g) || 100
  const factor = amount / 100

  // Per-100g reference values from the joined food_database columns
  const cal100  = Number(entry.calories_per_100g  || (entry.calories  / factor))
  const prot100 = Number(entry.protein_per_100g   || (entry.protein_g / factor))
  const carb100 = Number(entry.carbs_per_100g     || (entry.carbs_g   / factor))
  const fat100  = Number(entry.fat_per_100g       || (entry.fat_g     / factor))
  const fib100  = Number(entry.fiber_per_100g     || 0)
  const sod100  = Number(entry.sodium_per_100g    || 0)
  const fe100   = Number(entry.iron_per_100g      || 0)
  const ca100   = Number(entry.calcium_per_100g   || 0)

  const hasLabel = entry.calories_per_100g != null

  function startEdit(e) {
    e.stopPropagation()
    setEditing(true)
    setEditVal(String(amount))
    setTimeout(() => inputRef.current?.select(), 50)
  }

  function saveEdit() {
    const v = parseFloat(editVal)
    if (!v || v === amount) { setEditing(false); return }
    onUpdate(entry.id, v)
    setEditing(false)
  }

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      {/* Collapsed header — always visible */}
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full text-left px-3 py-2.5 flex items-start gap-2 hover:bg-gray-50 active:bg-gray-100"
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-semibold text-gray-900 truncate">{entry.food_name}</span>
            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full ${MEAL_COLORS[entry.meal_type] || 'bg-gray-100 text-gray-600'}`}>
              {entry.meal_type.replace('_', ' ')}
            </span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            <span className="text-xs text-gray-500">{amount}g</span>
            <span className="text-xs font-semibold text-gray-800">{Math.round(entry.calories || 0)} kcal</span>
            <span className="text-xs text-orange-600">P {fmt(entry.protein_g)}g</span>
            <span className="text-xs text-blue-600">C {fmt(entry.carbs_g)}g</span>
            <span className="text-xs text-yellow-600">F {fmt(entry.fat_g)}g</span>
            {entry.fiber_g > 0 && <span className="text-xs text-green-600">Fib {fmt(entry.fiber_g)}g</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 mt-0.5 shrink-0">
          <span className="text-gray-300 text-sm">{open ? '▲' : '▼'}</span>
          <button
            onClick={e => { e.stopPropagation(); onDelete(entry.id) }}
            className="text-red-400 text-lg px-1 leading-none"
            aria-label="delete"
          >×</button>
        </div>
      </button>

      {/* Expanded — food label table */}
      {open && (
        <div className="px-3 pb-3 bg-gray-50 border-t border-gray-100">
          <table className="w-full mt-2">
            <thead>
              <tr className="border-b-2 border-gray-300">
                <th className="text-left text-xs text-gray-500 font-semibold pb-1.5">{t('labelNutrient')}</th>
                <th className="text-right text-xs text-gray-500 font-semibold pb-1.5 pr-3">{t('labelPer100g')}</th>
                <th className="text-right text-xs text-gray-900 font-semibold pb-1.5">
                  {editing ? (
                    <span className="flex items-center justify-end gap-1">
                      <input
                        ref={inputRef}
                        type="number"
                        value={editVal}
                        onChange={e => setEditVal(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter') saveEdit(); if (e.key === 'Escape') setEditing(false) }}
                        className="w-16 border border-primary-400 rounded px-1 py-0.5 text-xs text-center focus:outline-none focus:ring-1 focus:ring-primary-500"
                      />
                      <span className="text-gray-500">g</span>
                      <button onClick={saveEdit} className="text-primary-600 font-bold text-xs">✓</button>
                    </span>
                  ) : (
                    <button onClick={startEdit} className="flex items-center justify-end gap-1 hover:text-primary-600">
                      {t('labelForAmount', { g: amount })}
                      <span className="text-gray-400 text-[10px]">✏</span>
                    </button>
                  )}
                </th>
              </tr>
            </thead>
            <tbody>
              <LabelRow label={t('labelEnergy')}   per100={cal100}  forAmount={cal100 * factor}  unit="kcal" highlight />
              <LabelRow label={t('labelProtein')}  per100={prot100} forAmount={prot100 * factor}  unit="g" />
              <LabelRow label={t('labelCarbs')}    per100={carb100} forAmount={carb100 * factor}  unit="g" />
              <LabelRow label={t('labelFat')}      per100={fat100}  forAmount={fat100 * factor}   unit="g" />
              {(fib100 > 0 || entry.fiber_g > 0) && (
                <LabelRow label={t('labelFiber')} per100={fib100} forAmount={fib100 * factor}  unit="g" />
              )}
              {sod100 > 0 && (
                <LabelRow label={t('labelSodium')} per100={sod100} forAmount={sod100 * factor} unit="mg" />
              )}
              {fe100 > 0 && (
                <LabelRow label={t('labelIron')} per100={fe100} forAmount={fe100 * factor} unit="mg" />
              )}
              {ca100 > 0 && (
                <LabelRow label={t('labelCalcium')} per100={ca100} forAmount={ca100 * factor} unit="mg" />
              )}
            </tbody>
          </table>
          {!hasLabel && (
            <p className="text-xs text-gray-400 mt-2 italic">{t('labelEstimated')}</p>
          )}
        </div>
      )}
    </div>
  )
}

function SearchResult({ food, onSelect }) {
  const amount = Number(food.calories_per_100g)
  return (
    <button
      onClick={() => onSelect(food)}
      className="w-full text-left px-3 py-2.5 hover:bg-gray-50 active:bg-gray-100"
    >
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium text-gray-900 truncate">{food.name}</span>
        <span className="text-xs font-semibold text-gray-700 shrink-0">{Math.round(food.calories_per_100g)} kcal</span>
      </div>
      <div className="flex items-center gap-2.5 mt-0.5 text-xs">
        <span className="text-gray-400 text-[10px] uppercase tracking-wide">per 100g</span>
        <span className="text-orange-600">P {fmt(food.protein_per_100g)}g</span>
        <span className="text-blue-600">C {fmt(food.carbs_per_100g)}g</span>
        <span className="text-yellow-600">F {fmt(food.fat_per_100g)}g</span>
        {food.fiber_per_100g > 0 && <span className="text-green-600">Fib {fmt(food.fiber_per_100g)}g</span>}
        {food.sodium_per_100g > 0 && <span className="text-gray-500">Na {Math.round(food.sodium_per_100g)}mg</span>}
      </div>
    </button>
  )
}

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
  const updateFood = useMutation({
    mutationFn: ({ id, amount_g }) => api.put(`/api/food/log/${id}`, { amount_g }),
    onSuccess: () => {
      qc.invalidateQueries(['food-log', date])
      toast.success(t('amountUpdated'))
    },
  })

  const applyLabelCorrection = useMutation({
    mutationFn: ({ food_id, nutrients }) =>
      api.patch(`/api/food/database/${food_id}`, { nutrients }),
    onSuccess: () => {
      qc.invalidateQueries(['food-log', date])
      toast.success(t('ocrApplied'))
    },
    onError: () => toast.error(t('ocrApplyError')),
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

            {/* Calorie formula — always visible */}
            {f.neat_kcal != null && (
              <div className="pt-2 border-t border-gray-100 space-y-1">
                <div className="flex justify-between text-xs text-gray-500">
                  <span>Base (BMR × 1.30 NEAT)</span>
                  <span className="font-medium tabular-nums">{f.neat_kcal?.toLocaleString()} kcal</span>
                </div>
                {f.eee_kcal > 0 && (
                  <div className="flex justify-between text-xs text-blue-600">
                    <span>+ Training ({f.workouts_min} min, Zone {f.max_zone})</span>
                    <span className="font-medium tabular-nums">+{(f.eee_kcal + f.epoc_kcal).toLocaleString()} kcal</span>
                  </div>
                )}
                <div className="flex justify-between text-xs font-semibold text-gray-700 border-t border-gray-100 pt-1">
                  <span>= Daily target</span>
                  <span className="tabular-nums">{tgt.calories_kcal?.toLocaleString()} kcal</span>
                </div>
              </div>
            )}

            <div className="space-y-2.5 pt-1">
              <MacroRow label={t('macros.protein')} actual={totals.protein_g||0} target={targets.protein_g} unit="g" color="text-orange-600" barColor="bg-orange-400"
                formula={f.weight_kg ? `${f.protein_g_per_kg} g/kg × ${f.weight_kg} kg` : null} />
              <MacroRow label={t('macros.carbs')}   actual={totals.carbs_g||0}   target={targets.carbs_g}   unit="g" color="text-blue-600"   barColor="bg-blue-400"
                formula={f.weight_kg ? `${f.carb_g_per_kg} g/kg × ${f.weight_kg} kg` : null} />
              <MacroRow label={t('macros.fat')}     actual={totals.fat_g||0}     target={targets.fat_g}     unit="g" color="text-yellow-600" barColor="bg-yellow-400"
                formula={f.weight_kg ? `${f.fat_g_per_kg} g/kg × ${f.weight_kg} kg (residual)` : null} />
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

        {/* Scan food label */}
        <LabelScanner
          t={t}
          onApplyCorrection={({ food_id, food_name, nutrients }) =>
            applyLabelCorrection.mutate({ food_id, nutrients })
          }
        />

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
                <SearchResult key={f.id} food={f} onSelect={food => { setSelected(food); setSearchResults([]); setSearch(food.name) }} />
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
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-semibold text-gray-900">{t('todayLog')}</h2>
              <span className="text-xs text-gray-400">{t('tapToExpand')}</span>
            </div>
            <div className="space-y-2">
              {entries.map(e => (
                <FoodEntry
                  key={e.id}
                  entry={e}
                  t={t}
                  onDelete={id => deleteFood.mutate(id)}
                  onUpdate={(id, amount_g) => updateFood.mutate({ id, amount_g })}
                />
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-gray-100 flex items-center justify-between">
              <span className="text-xs text-gray-500 font-medium">{t('totalDay')}</span>
              <div className="flex gap-3 text-xs">
                <span className="font-semibold text-gray-900">{Math.round(totals.calories || 0)} kcal</span>
                <span className="text-orange-600">P {fmt(totals.protein_g)}g</span>
                <span className="text-blue-600">C {fmt(totals.carbs_g)}g</span>
                <span className="text-yellow-600">F {fmt(totals.fat_g)}g</span>
              </div>
            </div>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}
