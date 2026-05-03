import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import api from '../services/api'
import BottomNav from '../components/BottomNav'
import toast from 'react-hot-toast'

export default function Nutrition() {
  const today = new Date().toISOString().split('T')[0]
  const [date, setDate] = useState(today)
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
      toast.success('Food logged!')
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
  const totals = logData?.totals || {}
  const meals = ['breakfast','lunch','dinner','snack','pre_workout','post_workout']

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold">Nutrition</h1>
        <input type="date" value={date} onChange={e => setDate(e.target.value)}
          className="mt-2 bg-primary-700 text-white rounded-lg px-3 py-1 text-sm border border-primary-500 w-full" />
      </div>

      <div className="px-4 mt-4 space-y-4">
        {/* Targets vs actual */}
        {targets && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Daily Targets</h2>
            <div className="grid grid-cols-4 gap-2">
              {[
                { label: 'Calories', target: targets.calories_kcal, actual: Math.round(totals.calories||0), unit: 'kcal', color: 'text-gray-900' },
                { label: 'Protein',  target: targets.protein_g,     actual: Math.round(totals.protein_g||0), unit: 'g', color: 'text-orange-600' },
                { label: 'Carbs',    target: targets.carbs_g,       actual: Math.round(totals.carbs_g||0), unit: 'g', color: 'text-blue-600' },
                { label: 'Fat',      target: targets.fat_g,         actual: Math.round(totals.fat_g||0), unit: 'g', color: 'text-yellow-600' },
              ].map(m => {
                const pct = Math.min(100, Math.round((m.actual / m.target) * 100)) || 0
                return (
                  <div key={m.label} className="text-center">
                    <p className={`text-lg font-bold ${m.color}`}>{m.actual}<span className="text-xs font-normal text-gray-400">{m.unit}</span></p>
                    <p className="text-xs text-gray-500 mb-1">{m.label}</p>
                    <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className="h-full bg-primary-500 rounded-full transition-all" style={{ width: `${pct}%` }} />
                    </div>
                    <p className="text-xs text-gray-400 mt-0.5">/ {m.target}{m.unit}</p>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Add food */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h2 className="font-semibold text-gray-900 mb-3">Add Food</h2>
          <div className="flex gap-2 mb-3">
            {meals.map(m => (
              <button key={m} onClick={() => setMeal(m)}
                className={`px-2 py-1 rounded-lg text-xs font-medium whitespace-nowrap ${meal===m ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-600'}`}>
                {m.replace('_',' ')}
              </button>
            ))}
          </div>
          <input value={search} onChange={e => doSearch(e.target.value)} placeholder="Search food (e.g. chicken, rice...)"
            className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500 mb-2" />
          {searchResults.length > 0 && (
            <div className="border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100 mb-3">
              {searchResults.map(f => (
                <button key={f.id} onClick={() => { setSelected(f); setSearchResults([]); setSearch(f.name) }}
                  className="w-full text-left px-3 py-2 text-sm hover:bg-gray-50">
                  <span className="font-medium">{f.name}</span>
                  <span className="text-gray-400 ml-2">{f.calories_per_100g} kcal/100g · {f.protein_per_100g}g protein</span>
                </button>
              ))}
            </div>
          )}
          {selected && (
            <div className="flex gap-2">
              <input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="100"
                className="w-24 border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
                suffix="g" />
              <span className="self-center text-gray-500 text-sm">g</span>
              <button onClick={() => addFood.mutate({ food_id: selected.id, amount_g: parseFloat(amount), log_date: date, meal_type: meal })}
                disabled={addFood.isPending}
                className="flex-1 bg-primary-600 text-white rounded-xl py-2 text-sm font-medium active:bg-primary-700 disabled:opacity-50">
                Add
              </button>
            </div>
          )}
        </div>

        {/* Food log */}
        {entries.length > 0 && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <h2 className="font-semibold text-gray-900 mb-3">Today's Log</h2>
            <div className="space-y-2">
              {entries.map(e => (
                <div key={e.id} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{e.food_name}</p>
                    <p className="text-xs text-gray-500">{e.amount_g}g · {Math.round(e.calories||0)} kcal · {e.meal_type}</p>
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
