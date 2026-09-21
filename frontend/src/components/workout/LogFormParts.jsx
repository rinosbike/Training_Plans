// Form pieces shared by the planned-workout log form (WorkoutDetail) and the
// standalone "Add workout" page.
import { useState } from 'react'

// Renumber every row's set_number to its 1-based position within its own
// exercise group, so "Set 2, Set 3" never has a gap after a removal.
function renumberSets(list) {
  const counts = {}
  return list.map(s => {
    counts[s.exercise_id] = (counts[s.exercise_id] || 0) + 1
    return { ...s, set_number: counts[s.exercise_id] }
  })
}

export function ExerciseSetLogger({ t, exercises, sets, onChange }) {
  const [picker, setPicker] = useState('')
  const byId = Object.fromEntries(exercises.map(e => [e.id, e]))
  const order = []
  for (const s of sets) if (!order.includes(s.exercise_id)) order.push(s.exercise_id)

  const addExercise = (exerciseId) => {
    onChange(renumberSets([...sets, { exercise_id: exerciseId, set_number: 0, reps: '', duration_sec: '', weight_kg: '' }]))
  }
  const removeSet = (exerciseId, setNumber) => {
    onChange(renumberSets(sets.filter(s => !(s.exercise_id === exerciseId && s.set_number === setNumber))))
  }
  const removeExercise = (exerciseId) => {
    onChange(renumberSets(sets.filter(s => s.exercise_id !== exerciseId)))
  }
  const updateRow = (exerciseId, setNumber, field, value) => {
    onChange(sets.map(s => (s.exercise_id === exerciseId && s.set_number === setNumber) ? { ...s, [field]: value } : s))
  }

  return (
    <div className="border border-gray-200 rounded-xl p-3 bg-gray-50">
      <p className="text-sm font-medium text-gray-700">{t('exerciseLog.title')}</p>
      <p className="text-xs text-gray-500 mt-0.5 mb-3">{t('exerciseLog.hint')}</p>

      {order.length === 0 && (
        <p className="text-xs text-gray-400 italic mb-3">{t('exerciseLog.noExercisesYet')}</p>
      )}

      <div className="space-y-3">
        {order.map(exerciseId => {
          const ex = byId[exerciseId]
          const rows = sets.filter(s => s.exercise_id === exerciseId).sort((a, b) => a.set_number - b.set_number)
          const isSeconds = ex?.unit === 'seconds'
          return (
            <div key={exerciseId} className="bg-white rounded-lg border border-gray-200 p-2.5">
              <div className="flex items-center justify-between mb-2">
                <p className="text-sm font-semibold text-gray-900">{ex ? t(`exercises.${ex.key}`) : '—'}</p>
                <button type="button" onClick={() => removeExercise(exerciseId)}
                  className="text-xs text-gray-400 px-2 py-1 -mr-1 active:text-red-500">
                  {t('exerciseLog.removeExercise')}
                </button>
              </div>
              <div className="space-y-2">
                {rows.map(row => (
                  <div key={row.set_number} className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-gray-500 w-14 shrink-0">
                      {t('exerciseLog.setNumber', { n: row.set_number })}
                    </span>
                    <input
                      type="number" inputMode="numeric" min="0"
                      value={isSeconds ? row.duration_sec : row.reps}
                      onChange={e => updateRow(exerciseId, row.set_number, isSeconds ? 'duration_sec' : 'reps', e.target.value)}
                      placeholder={isSeconds ? t('exerciseLog.secondsPlaceholder') : t('exerciseLog.repsPlaceholder')}
                      className="w-20 border border-gray-300 rounded-lg px-2 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                    />
                    {ex?.allow_weight && (
                      <input
                        type="number" inputMode="decimal" min="0" step="0.5"
                        value={row.weight_kg}
                        onChange={e => updateRow(exerciseId, row.set_number, 'weight_kg', e.target.value)}
                        placeholder={t('exerciseLog.weightOptional')}
                        className="flex-1 min-w-[7rem] border border-gray-300 rounded-lg px-2 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500"
                      />
                    )}
                    <button type="button" onClick={() => removeSet(exerciseId, row.set_number)}
                      aria-label={t('exerciseLog.removeSet')}
                      className="ml-auto w-9 h-9 shrink-0 rounded-lg text-gray-400 active:bg-gray-100 active:text-red-500 text-lg leading-none">
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <button type="button" onClick={() => addExercise(exerciseId)}
                className="mt-2 text-xs font-medium text-primary-600 py-1.5 px-2 -ml-2 active:bg-primary-50 rounded-lg">
                {t('exerciseLog.addSet')}
              </button>
            </div>
          )
        })}
      </div>

      <select
        value={picker}
        onChange={e => {
          if (e.target.value) { addExercise(Number(e.target.value)); setPicker('') }
        }}
        className="mt-3 w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-primary-500"
      >
        <option value="">{t('exerciseLog.addExercise')}</option>
        {exercises.map(ex => (
          <option key={ex.id} value={ex.id}>{t(`exercises.${ex.key}`)}</option>
        ))}
      </select>
    </div>
  )
}

export function LogField({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white" />
    </div>
  )
}
