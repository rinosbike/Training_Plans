import { useQuery } from '@tanstack/react-query'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from 'recharts'
import api from '../services/api'
import BottomNav from '../components/BottomNav'

export default function Progress() {
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

  return (
    <div className="min-h-screen bg-gray-50 pb-nav">
      <div className="bg-primary-600 text-white px-4 pt-12 pb-4">
        <h1 className="text-xl font-bold">Training Load</h1>
        <p className="text-primary-200 text-sm">CTL · ATL · Form (TSB)</p>
      </div>

      <div className="px-4 mt-4 space-y-4">
        {load.length > 0 ? (
          <>
            {/* Current values */}
            {load.length > 0 && (() => {
              const latest = load[load.length - 1]
              return (
                <div className="grid grid-cols-3 gap-3">
                  <MetricCard label="Fitness (CTL)" value={Math.round(latest.ctl||0)} color="text-blue-600" bg="bg-blue-50" desc="42-day avg TSS/day" />
                  <MetricCard label="Fatigue (ATL)" value={Math.round(latest.atl||0)} color="text-red-600" bg="bg-red-50" desc="7-day avg TSS/day" />
                  <MetricCard label="Form (TSB)" value={Math.round(latest.tsb||0)} color={latest.tsb >= 0 ? 'text-green-600' : 'text-orange-600'} bg={latest.tsb >= 0 ? 'bg-green-50' : 'bg-orange-50'} desc="CTL − ATL" />
                </div>
              )
            })()}

            {/* Chart */}
            <div className="bg-white rounded-2xl border border-gray-100 p-4">
              <h2 className="font-semibold text-gray-900 mb-4">Last 60 Days</h2>
              <ResponsiveContainer width="100%" height={220}>
                <LineChart data={chartData.slice(-60)} margin={{ top: 5, right: 5, bottom: 5, left: -15 }}>
                  <XAxis dataKey="date" tick={{ fontSize: 10 }} tickLine={false} interval={9} />
                  <YAxis tick={{ fontSize: 10 }} tickLine={false} />
                  <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                  <Legend wrapperStyle={{ fontSize: 12 }} />
                  <Line type="monotone" dataKey="CTL" stroke="#3b82f6" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="ATL" stroke="#ef4444" dot={false} strokeWidth={2} />
                  <Line type="monotone" dataKey="Form" stroke="#22c55e" dot={false} strokeWidth={1.5} strokeDasharray="4 2" />
                </LineChart>
              </ResponsiveContainer>
              <div className="mt-2 text-xs text-gray-400 space-y-1">
                <p>Form &gt; 5: Fresh — ready to race or go hard</p>
                <p>Form −10 to 5: Normal training state</p>
                <p>Form &lt; −20: Fatigued — recovery needed</p>
              </div>
            </div>
          </>
        ) : (
          <div className="text-center py-16 text-gray-400">
            <div className="text-4xl mb-3">📈</div>
            <p className="font-medium text-gray-600">No training data yet</p>
            <p className="text-sm">Log some workouts to see your load trends.</p>
          </div>
        )}
      </div>

      <BottomNav />
    </div>
  )
}

function MetricCard({ label, value, color, bg, desc }) {
  return (
    <div className={`${bg} rounded-2xl p-3 text-center`}>
      <p className={`text-2xl font-bold ${color}`}>{value}</p>
      <p className="text-xs font-semibold text-gray-700 mt-0.5">{label}</p>
      <p className="text-xs text-gray-400 mt-0.5">{desc}</p>
    </div>
  )
}
