import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, ReferenceLine,
  ResponsiveContainer, Cell, ComposedChart, Line, Brush,
} from 'recharts'
import { MapContainer, TileLayer, Polyline, CircleMarker, useMap } from 'react-leaflet'
import api from '../services/api'
import { SportBadge } from '../components/workout/SportIcon'
import toast from 'react-hot-toast'

const ZONE_COLORS = ['bg-blue-300', 'bg-green-300', 'bg-yellow-300', 'bg-orange-400', 'bg-red-500']
const ZONE_TEXT   = ['text-blue-800', 'text-green-800', 'text-yellow-800', 'text-orange-800', 'text-red-700']

// Zone color scales used in charts (hex for Recharts)
const ZONE_HEX = ['#93c5fd', '#86efac', '#fde047', '#fb923c', '#ef4444']

const HR_ZONES = [
  { z: 1, pct: [0.50, 0.60], bar: 'bg-green-200',   text: 'text-green-900',   border: 'border-green-200' },
  { z: 2, pct: [0.60, 0.70], bar: 'bg-teal-300',    text: 'text-teal-900',    border: 'border-teal-200' },
  { z: 3, pct: [0.70, 0.80], bar: 'bg-yellow-300',  text: 'text-yellow-900',  border: 'border-yellow-300' },
  { z: 4, pct: [0.80, 0.90], bar: 'bg-orange-400',  text: 'text-white',       border: 'border-orange-300' },
  { z: 5, pct: [0.90, 1.00], bar: 'bg-red-500',     text: 'text-white',       border: 'border-red-400' },
]

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtPace(speedMs) {
  if (!speedMs || speedMs <= 0) return '—'
  const secPerKm = 1000 / speedMs
  const m = Math.floor(secPerKm / 60)
  const s = Math.round(secPerKm % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

function fmtSpeed(speedMs) {
  if (!speedMs) return '—'
  return `${(speedMs * 3.6).toFixed(1)} km/h`
}

function fmtDuration(sec) {
  if (!sec) return '—'
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${m}:${String(s).padStart(2,'0')}`
}

function fmtTimeSec(sec) {
  const h = Math.floor(sec / 3600)
  const m = Math.floor((sec % 3600) / 60)
  const s = sec % 60
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
  return `${m}:${String(s).padStart(2,'0')}`
}

function isRunSport(sportType) {
  return /run|walk|hike/i.test(sportType || '')
}

// Returns bar bin size (km per bar) based on how many splits an activity has
function getBinSize(numSplits) {
  if (numSplits <= 20) return 1
  if (numSplits <= 50) return 2
  if (numSplits <= 100) return 5
  return 10
}

function hrZoneIndex(bpm, maxHr) {
  if (!bpm || !maxHr) return -1
  const pct = bpm / maxHr
  if (pct >= 0.90) return 4
  if (pct >= 0.80) return 3
  if (pct >= 0.70) return 2
  if (pct >= 0.60) return 1
  return 0
}

// ---------------------------------------------------------------------------
// HR zone targets (planned workout)
// ---------------------------------------------------------------------------

function HRZones({ maxHr, activeZone }) {
  const { t } = useTranslation('workouts')
  if (!maxHr) return (
    <p className="text-xs text-amber-700 bg-amber-50 rounded-xl px-3 py-2.5 mt-3">
      {t('zones.noHr')}
    </p>
  )
  return (
    <div className="mt-3 space-y-1.5">
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {t('zones.title', { bpm: maxHr })}
      </p>
      {HR_ZONES.map(z => {
        const lo = Math.round(z.pct[0] * maxHr)
        const hi = z.z === 5 ? maxHr : Math.round(z.pct[1] * maxHr)
        const active = z.z === activeZone
        return (
          <div key={z.z} className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${z.bar} ${z.border} transition-all ${active ? 'ring-2 ring-primary-500 ring-offset-1' : 'opacity-75'}`}>
            <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${active ? 'bg-white/90 text-gray-800 shadow-sm' : 'bg-white/50 text-gray-700'}`}>
              {z.z}
            </div>
            <span className={`flex-1 text-sm font-semibold ${z.text}`}>
              Z{z.z} — {t(`zones.${z.z}.name`)}
            </span>
            <span className={`text-sm font-mono font-bold tabular-nums ${z.text}`}>{lo}–{hi} bpm</span>
            {active && (
              <span className={`text-xs px-2 py-0.5 rounded-full bg-white/30 font-medium ${z.text}`}>
                {t('zones.target')}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Polyline decoder (Google Encoded Polyline Algorithm)
// ---------------------------------------------------------------------------

function decodePolyline(encoded) {
  const coords = []
  let index = 0, lat = 0, lng = 0
  while (index < encoded.length) {
    let shift = 0, result = 0, b
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    shift = 0; result = 0
    do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5 } while (b >= 0x20)
    lng += result & 1 ? ~(result >> 1) : result >> 1
    coords.push([lat * 1e-5, lng * 1e-5])
  }
  return coords
}

// Auto-fit map bounds to the polyline
function FitBounds({ positions }) {
  const map = useMap()
  useEffect(() => {
    if (positions.length > 0) map.fitBounds(positions, { padding: [16, 16] })
  }, [map, positions])
  return null
}

// ---------------------------------------------------------------------------
// Route map
// ---------------------------------------------------------------------------

const MAP_LAYERS = [
  {
    id: 'street',
    labelKey: 'strava.map.street',
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    routeColor: '#ef4444',
  },
  {
    id: 'satellite',
    labelKey: 'strava.map.satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    routeColor: '#facc15',
  },
  {
    id: 'topo',
    labelKey: 'strava.map.topo',
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    routeColor: '#ef4444',
  },
]

// Swap tile layer without remounting the MapContainer
function TileLayerSwitcher({ url }) {
  const map = useMap()
  useEffect(() => {
    // remove all existing tile layers then add the new one
    map.eachLayer(layer => { if (layer._url) map.removeLayer(layer) })
    window.L.tileLayer(url).addTo(map)
  }, [map, url])
  return null
}

function RouteMap({ polyline, activityId }) {
  const { t } = useTranslation('workouts')
  const [activeLayer, setActiveLayer] = useState('street')
  if (!polyline) return null
  const positions = decodePolyline(polyline)
  if (positions.length < 2) return null

  const start  = positions[0]
  const end    = positions[positions.length - 1]
  const layer  = MAP_LAYERS.find(l => l.id === activeLayer)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('strava.map.title')}</p>
        <a
          href={`https://www.strava.com/activities/${activityId}`}
          target="_blank" rel="noopener noreferrer"
          className="text-[10px] text-orange-500 font-medium"
        >
          {t('strava.map.viewOnStrava')}
        </a>
      </div>

      {/* Layer selector */}
      <div className="flex gap-1 mb-2">
        {MAP_LAYERS.map(l => (
          <button
            key={l.id}
            onClick={() => setActiveLayer(l.id)}
            className={`px-3 py-1 text-xs rounded-lg font-medium transition-colors ${
              activeLayer === l.id
                ? 'bg-gray-800 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {t(l.labelKey)}
          </button>
        ))}
      </div>

      <div className="rounded-2xl overflow-hidden border border-gray-100 h-[260px] sm:h-[340px] lg:h-[400px]">
        <MapContainer
          center={start}
          zoom={13}
          style={{ height: '100%', width: '100%' }}
          attributionControl={false}
        >
          <TileLayer url={layer.url} />
          <TileLayerSwitcher url={layer.url} />
          <Polyline positions={positions} color={layer.routeColor} weight={3} opacity={0.9} />
          <CircleMarker center={start} color="#16a34a" fillColor="#16a34a" fillOpacity={1} radius={5} weight={2} />
          <CircleMarker center={end}   color={layer.routeColor} fillColor={layer.routeColor} fillOpacity={1} radius={5} weight={2} />
          <FitBounds positions={positions} />
        </MapContainer>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Strava Analysis sub-components
// ---------------------------------------------------------------------------

function ZoneBar({ label, buckets, unit }) {
  if (!buckets || buckets.length === 0) return null
  const totalSec = buckets.reduce((s, b) => s + (b.time || 0), 0)
  if (totalSec === 0) return null

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</p>
      <div className="flex h-3 rounded-full overflow-hidden mb-3">
        {buckets.map((b, i) => {
          const pct = (b.time / totalSec) * 100
          if (pct < 0.5) return null
          return <div key={i} className={ZONE_COLORS[i] || 'bg-gray-300'} style={{ width: `${pct}%` }} />
        })}
      </div>
      <div className="space-y-1.5">
        {buckets.map((b, i) => {
          const pct = (b.time / totalSec) * 100
          const rangeLabel = b.max === -1 ? `Z${i+1} — ${b.min}+ ${unit}` : `Z${i+1} — ${b.min}–${b.max} ${unit}`
          return (
            <div key={i} className="flex items-center gap-2">
              <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${ZONE_COLORS[i] || 'bg-gray-300'}`} />
              <span className="text-xs text-gray-600 flex-1">{rangeLabel}</span>
              <span className="text-xs font-mono text-gray-500 w-10 text-right">{fmtDuration(b.time)}</span>
              <span className={`text-xs font-semibold w-9 text-right ${ZONE_TEXT[i] || 'text-gray-600'}`}>
                {pct < 1 ? '<1' : Math.round(pct)}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Peak Moments — auto-computed highlights from stream data
// ---------------------------------------------------------------------------

function PeakMoments({ streams, isRun, maxHr }) {
  const { t } = useTranslation('workouts')
  const hr  = streams?.heartrate
  const vel = streams?.velocity_smooth
  const alt = streams?.altitude
  const tim = streams?.time

  if (!hr && !vel) return null

  const moments = []

  if (hr && hr.length > 0) {
    const peak = Math.max(...hr)
    const idx  = hr.lastIndexOf(peak)
    const ts   = tim?.[idx]
    moments.push({
      icon: '❤️',
      label: 'Peak HR',
      value: `${peak} bpm${maxHr ? ` · Z${hrZoneIndex(peak, maxHr) + 1}` : ''}`,
      sub: ts != null ? `at ${fmtTimeSec(ts)}` : null,
      color: 'text-red-600',
    })
  }

  if (vel && vel.length > 0) {
    const WINDOW = 12 // ~60 sec at 5s sampling
    let bestAvg = 0, bestIdx = 0
    for (let i = 0; i <= vel.length - WINDOW; i++) {
      const avg = vel.slice(i, i + WINDOW).reduce((a, b) => a + b, 0) / WINDOW
      if (avg > bestAvg) { bestAvg = avg; bestIdx = i }
    }
    const ts = tim?.[bestIdx]
    moments.push({
      icon: '⚡',
      label: isRun ? 'Best 60s Pace' : 'Best 60s Speed',
      value: isRun ? fmtPace(bestAvg) + '/km' : `${(bestAvg * 3.6).toFixed(1)} km/h`,
      sub: ts != null ? `at ${fmtTimeSec(ts)}` : null,
      color: 'text-blue-600',
    })
  }

  if (alt && alt.length > 0) {
    const gain = alt.reduce((sum, v, i) => i === 0 ? 0 : sum + Math.max(0, v - alt[i - 1]), 0)
    const peak = Math.max(...alt)
    moments.push({
      icon: '⛰️',
      label: 'Elevation',
      value: `+${Math.round(gain)} m`,
      sub: `peak ${Math.round(peak)} m`,
      color: 'text-orange-600',
    })
  }

  if (moments.length === 0) return null

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {t('strava.peakMoments', { defaultValue: 'Peak Moments' })}
      </p>
      <div className="grid grid-cols-3 gap-2">
        {moments.map((m) => (
          <div key={m.label} className="bg-gray-50 rounded-xl p-2.5">
            <div className="text-base mb-0.5">{m.icon}</div>
            <p className={`text-sm font-bold ${m.color} leading-tight`}>{m.value}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{m.label}</p>
            {m.sub && <p className="text-[10px] text-gray-400">{m.sub}</p>}
          </div>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HR Stream Chart — continuous HR over time with zone reference lines
// ---------------------------------------------------------------------------

function HRStreamChart({ streams, maxHr, avgHr }) {
  const { t } = useTranslation('workouts')
  const [xMode, setXMode] = useState('time') // 'time' | 'distance'

  const hr   = streams?.heartrate
  const time = streams?.time
  const dist = streams?.distance

  if (!hr || hr.length === 0) return null

  const data = hr.map((bpm, i) => ({
    bpm,
    t:   time?.[i] ?? i,
    d:   dist?.[i] != null ? +(dist[i] / 1000).toFixed(2) : i,
  }))

  const minBpm = Math.max(40, Math.min(...hr) - 10)
  const maxBpm = Math.max(...hr) + 5

  const zoneBoundaries = maxHr
    ? [0.60, 0.70, 0.80, 0.90].map((pct, i) => ({
        bpm: Math.round(pct * maxHr),
        label: `Z${i + 2}`,
        color: ZONE_HEX[i + 1],
      }))
    : []

  const xKey     = xMode === 'time' ? 't' : 'd'
  const xFormatter = xMode === 'time'
    ? (v) => fmtTimeSec(v)
    : (v) => `${v} km`

  // Gradient stops: map each zone boundary to a y-axis percentage
  // SVG linearGradient y=0% = top (maxBpm), y=100% = bottom (minBpm)
  const range = maxBpm - minBpm
  const gradientStops = maxHr ? [
    { offset: '0%',   color: ZONE_HEX[4], opacity: 0.85 },
    { offset: `${Math.max(0, ((maxBpm - Math.round(0.90 * maxHr)) / range) * 100).toFixed(1)}%`, color: ZONE_HEX[4], opacity: 0.75 },
    { offset: `${Math.max(0, ((maxBpm - Math.round(0.80 * maxHr)) / range) * 100).toFixed(1)}%`, color: ZONE_HEX[3], opacity: 0.70 },
    { offset: `${Math.max(0, ((maxBpm - Math.round(0.70 * maxHr)) / range) * 100).toFixed(1)}%`, color: ZONE_HEX[2], opacity: 0.65 },
    { offset: `${Math.max(0, ((maxBpm - Math.round(0.60 * maxHr)) / range) * 100).toFixed(1)}%`, color: ZONE_HEX[1], opacity: 0.55 },
    { offset: '100%', color: ZONE_HEX[0], opacity: 0.40 },
  ] : [
    { offset: '0%',   color: '#ef4444', opacity: 0.7 },
    { offset: '100%', color: '#fca5a5', opacity: 0.3 },
  ]

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null
    const { bpm, t, d } = payload[0].payload
    const zi = hrZoneIndex(bpm, maxHr)
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-md px-3 py-2 text-xs">
        <p className="font-bold text-gray-900">{bpm} bpm{zi >= 0 && <span className="ml-1.5 font-normal text-gray-500">Z{zi + 1}</span>}</p>
        {xMode === 'time' ? <p className="text-gray-500">{fmtTimeSec(t)}</p> : <p className="text-gray-500">{d} km</p>}
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('strava.charts.heartRate')}</p>
          {avgHr && <p className="text-xs text-gray-400 mt-0.5">{t('strava.charts.avgBpm', { bpm: avgHr })}</p>}
        </div>
        <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
          <button
            onClick={() => setXMode('time')}
            className={`text-[10px] px-2 py-1 rounded-md font-medium transition-colors ${xMode === 'time' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
          >
            {t('strava.charts.time')}
          </button>
          <button
            onClick={() => setXMode('distance')}
            className={`text-[10px] px-2 py-1 rounded-md font-medium transition-colors ${xMode === 'distance' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500'}`}
          >
            {t('fields.distance')}
          </button>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={200}>
        <AreaChart data={data} syncId="activity" margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="hrGradient" x1="0" y1="0" x2="0" y2="1">
              {gradientStops.map((s, i) => (
                <stop key={i} offset={s.offset} stopColor={s.color} stopOpacity={s.opacity} />
              ))}
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey={xKey}
            tickFormatter={xFormatter}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={50}
          />
          <YAxis
            domain={[minBpm, maxBpm]}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <Tooltip content={<CustomTooltip />} />
          {zoneBoundaries.map(z => (
            <ReferenceLine
              key={z.bpm}
              y={z.bpm}
              stroke={z.color}
              strokeDasharray="4 3"
              strokeWidth={1.2}
              label={{ value: `${z.bpm}`, position: 'insideTopRight', fontSize: 9, fill: '#6b7280', dy: -3 }}
            />
          ))}
          <Area
            type="monotone"
            dataKey="bpm"
            stroke="#ef4444"
            strokeWidth={1.5}
            fill="url(#hrGradient)"
            dot={false}
            activeDot={{ r: 3, fill: '#ef4444' }}
            isAnimationActive={false}
          />
          {data.length > 300 && (
            <Brush
              dataKey={xKey}
              height={20}
              travellerWidth={8}
              stroke="#e5e7eb"
              fill="#f9fafb"
              tickFormatter={xFormatter}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Speed stream chart — continuous pace/speed over time, synced with HR chart
// ---------------------------------------------------------------------------

function SpeedStreamChart({ streams, isRun }) {
  const { t } = useTranslation('workouts')
  const vel  = streams?.velocity_smooth
  const time = streams?.time
  const dist = streams?.distance

  if (!vel || vel.length === 0) return null

  const data = vel.map((ms, i) => {
    const kmh  = +(ms * 3.6).toFixed(2)
    const pace = ms > 0.5 ? Math.round(1000 / ms) : null
    return {
      kmh,
      pace,
      display: isRun ? (pace ?? 0) : kmh,
      t: time?.[i] ?? i,
      d: dist?.[i] != null ? +(dist[i] / 1000).toFixed(2) : i,
    }
  })

  const vals    = data.map(d => d.display).filter(v => v > 0)
  const minVal  = Math.max(0, Math.min(...vals) * 0.85)
  const maxVal  = Math.max(...vals) * 1.08

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null
    const d = payload[0].payload
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-md px-3 py-2 text-xs">
        <p className="font-bold text-blue-700">
          {isRun ? `${fmtPace(d.kmh / 3.6)}/km` : `${d.kmh.toFixed(1)} km/h`}
        </p>
        <p className="text-gray-500">{fmtTimeSec(d.t)}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <div>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
            {isRun ? t('strava.charts.pace', { defaultValue: 'PACE' }) : t('strava.charts.speed', { defaultValue: 'SPEED' })}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {t('strava.charts.perSecond', { defaultValue: 'per second · synced with HR' })}
          </p>
        </div>
      </div>
      <ResponsiveContainer width="100%" height={160}>
        <AreaChart data={data} syncId="activity" margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="speedGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.75} />
              <stop offset="100%" stopColor="#93c5fd" stopOpacity={0.20} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="t"
            tickFormatter={fmtTimeSec}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
            minTickGap={50}
          />
          <YAxis
            domain={[minVal, maxVal]}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={42}
            tickFormatter={v => isRun
              ? fmtPace(v > 0 ? 1000 / (v / 3.6 || 0.001) : 0)
              : `${v.toFixed(0)}`
            }
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="display"
            stroke="#3b82f6"
            strokeWidth={1.5}
            fill="url(#speedGradient)"
            dot={false}
            activeDot={{ r: 3, fill: '#3b82f6' }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Pace bar chart per km with HR overlay
// ---------------------------------------------------------------------------

function PaceBarChart({ splits, sportType, showTableToggle }) {
  const [showTable, setShowTable] = useState(false)
  const { t } = useTranslation('workouts')
  const isRun = isRunSport(sportType)

  if (!splits || splits.length === 0) return null

  const speeds = splits.map(x => x.average_speed || 0).filter(Boolean)
  const minSpd = Math.min(...speeds)
  const maxSpd = Math.max(...speeds)

  const rawData = splits.map((s, i) => {
    const speed  = s.average_speed || 0
    const relSpd = speeds.length > 1 && maxSpd > minSpd
      ? (speed - minSpd) / (maxSpd - minSpd) : 0.5
    const isLast = i === splits.length - 1
    const label  = isLast && s.distance < 950
      ? `${(s.distance / 1000).toFixed(2)}`
      : `${s.split}`
    return {
      km:     label,
      speed,
      hr:     s.average_heartrate ? Math.round(s.average_heartrate) : null,
      elev:   s.elevation_difference,
      relSpd,
      gap:    s.average_grade_adjusted_speed,
    }
  })

  const binSize = getBinSize(splits.length)
  const data = binSize === 1 ? rawData : (() => {
    const out = []
    for (let i = 0; i < rawData.length; i += binSize) {
      const group = rawData.slice(i, Math.min(i + binSize, rawData.length))
      const avgSpd = group.reduce((s, d) => s + d.speed, 0) / group.length
      const validHr = group.map(d => d.hr).filter(Boolean)
      const avgHr = validHr.length ? Math.round(validHr.reduce((a, b) => a + b, 0) / validHr.length) : null
      const relSpd = maxSpd > minSpd ? (avgSpd - minSpd) / (maxSpd - minSpd) : 0.5
      const km1 = splits[i]?.split ?? i + 1
      const km2 = splits[Math.min(i + binSize - 1, splits.length - 1)]?.split ?? km1
      out.push({
        km:    `${km1}–${km2}`,
        speed: avgSpd,
        hr:    avgHr,
        elev:  group.reduce((s, d) => s + (d.elev || 0), 0),
        relSpd,
        gap:   null,
      })
    }
    return out
  })()

  const barColor = (rel) => {
    if (rel > 0.66) return '#16a34a'
    if (rel > 0.33) return '#ca8a04'
    return '#dc2626'
  }

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.[0]) return null
    const d = payload[0].payload
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-md px-3 py-2 text-xs space-y-0.5">
        <p className="font-bold text-gray-900">km {label}</p>
        <p className="text-gray-700">{isRun ? `Pace: ${fmtPace(d.speed)}` : `Speed: ${fmtSpeed(d.speed)}`}</p>
        {d.hr && <p className="text-rose-600">HR: {d.hr} bpm</p>}
        {d.elev != null && <p className={d.elev > 0 ? 'text-orange-600' : 'text-blue-500'}>{d.elev > 0 ? '+' : ''}{Math.round(d.elev)} m</p>}
        {isRun && d.gap && <p className="text-gray-400">GAP: {fmtPace(d.gap)}</p>}
      </div>
    )
  }

  const hasHr = data.some(d => d.hr)

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
          {isRun ? t('strava.charts.pacePerKm') : t('strava.charts.speedPerKm')}
        </p>
        {showTableToggle && (
          <button
            onClick={() => setShowTable(p => !p)}
            className="text-[10px] text-primary-600 font-medium"
          >
            {showTable ? t('strava.charts.hideTable') : t('strava.charts.showTable')}
          </button>
        )}
      </div>

      <ResponsiveContainer width="100%" height={data.length > 30 ? 180 : 160}>
        <ComposedChart data={data} margin={{ top: 4, right: hasHr ? 8 : 4, left: -8, bottom: data.length > 15 ? 16 : 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="km"
            tick={{ fontSize: data.length > 20 ? 8 : 10, fill: '#9ca3af', angle: data.length > 20 ? -45 : 0, textAnchor: data.length > 20 ? 'end' : 'middle', dy: data.length > 20 ? 4 : 0 }}
            tickLine={false}
            axisLine={false}
            interval={data.length > 40 ? 1 : 0}
          />
          <YAxis
            yAxisId="spd"
            domain={[minSpd * 0.92, maxSpd * 1.05]}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={42}
            tickFormatter={v => isRun ? fmtPace(v) : `${(v * 3.6).toFixed(0)}`}
          />
          {hasHr && (
            <YAxis
              yAxisId="hr"
              orientation="right"
              domain={['auto', 'auto']}
              tick={{ fontSize: 10, fill: '#fca5a5' }}
              tickLine={false}
              axisLine={false}
              width={34}
            />
          )}
          <Tooltip content={<CustomTooltip />} />
          <Bar yAxisId="spd" dataKey="speed" radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={barColor(d.relSpd)} fillOpacity={0.85} />
            ))}
          </Bar>
          {hasHr && (
            <Line
              yAxisId="hr"
              type="monotone"
              dataKey="hr"
              stroke="#ef4444"
              strokeWidth={1.5}
              dot={{ r: 2.5, fill: '#ef4444', strokeWidth: 0 }}
              activeDot={{ r: 4 }}
              isAnimationActive={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {showTable && <SplitsTable splits={splits} sportType={sportType} />}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Elevation profile
// ---------------------------------------------------------------------------

function ElevationChart({ streams }) {
  const { t } = useTranslation('workouts')
  const alt  = streams?.altitude
  const dist = streams?.distance

  if (!alt || alt.length === 0) return null

  const data = alt.map((m, i) => ({
    alt: Math.round(m),
    d:   dist?.[i] != null ? +(dist[i] / 1000).toFixed(2) : i,
  }))

  const minAlt = Math.min(...alt)
  const maxAlt = Math.max(...alt)
  const range  = maxAlt - minAlt

  const CustomTooltip = ({ active, payload }) => {
    if (!active || !payload?.[0]) return null
    const { alt: a, d } = payload[0].payload
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-md px-3 py-2 text-xs">
        <p className="font-bold text-gray-900">{a} m</p>
        <p className="text-gray-500">{d} km</p>
      </div>
    )
  }

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{t('strava.extras.elevation')}</p>
      <ResponsiveContainer width="100%" height={110}>
        <AreaChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: 0 }}>
          <defs>
            <linearGradient id="elevGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#f97316" stopOpacity={0.75} />
              <stop offset="100%" stopColor="#93c5fd" stopOpacity={0.30} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="d"
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            tickFormatter={v => `${v}`}
            unit=" km"
            interval="preserveStartEnd"
            minTickGap={40}
          />
          <YAxis
            domain={[Math.max(0, minAlt - range * 0.1), maxAlt + range * 0.15]}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={42}
            tickFormatter={v => `${Math.round(v)}`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Area
            type="monotone"
            dataKey="alt"
            stroke="#f97316"
            strokeWidth={1.5}
            fill="url(#elevGradient)"
            dot={false}
            activeDot={{ r: 3, fill: '#f97316' }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cadence chart per km window
// ---------------------------------------------------------------------------

function CadenceChart({ streams, splits, isRun }) {
  const { t } = useTranslation('workouts')
  const cad  = streams?.cadence
  const time = streams?.time
  const dist = streams?.distance

  if (!cad || cad.length === 0) return null

  // Bucket cadence into per-km windows using distance stream
  let data
  if (dist && splits && splits.length > 0) {
    const kmBuckets = []
    let bucketIdx = 0
    let sum = 0, count = 0

    for (let i = 0; i < cad.length; i++) {
      const kmReached = splits[bucketIdx]?.split
      const dKm = dist[i] / 1000
      if (dKm >= (bucketIdx + 1)) {
        if (count > 0) {
          const spm = isRun ? Math.round((sum / count) * 2) : Math.round(sum / count)
          kmBuckets.push({ km: `${bucketIdx + 1}`, spm })
        }
        bucketIdx++
        sum = 0; count = 0
        if (bucketIdx >= splits.length) break
      }
      sum += cad[i]; count++
    }
    if (count > 0 && bucketIdx < splits.length) {
      const spm = isRun ? Math.round((sum / count) * 2) : Math.round(sum / count)
      kmBuckets.push({ km: `${bucketIdx + 1}`, spm })
    }
    data = kmBuckets
  } else {
    // Fallback: group into ~30-second windows
    const windowSize = Math.max(1, Math.round(cad.length / 30))
    data = []
    for (let i = 0; i < cad.length; i += windowSize) {
      const slice = cad.slice(i, i + windowSize)
      const avg   = slice.reduce((a, b) => a + b, 0) / slice.length
      const spm   = isRun ? Math.round(avg * 2) : Math.round(avg)
      data.push({ km: `${data.length + 1}`, spm })
    }
  }

  if (data.length === 0) return null

  // Adaptive binning for long activities
  const cadBinSize = getBinSize(data.length)
  if (cadBinSize > 1) {
    const binned = []
    for (let i = 0; i < data.length; i += cadBinSize) {
      const group = data.slice(i, Math.min(i + cadBinSize, data.length))
      const avgSpm = Math.round(group.reduce((s, d) => s + d.spm, 0) / group.length)
      const km1 = data[i].km
      const km2 = data[Math.min(i + cadBinSize - 1, data.length - 1)].km
      binned.push({ km: `${km1}–${km2}`, spm: avgSpm })
    }
    data = binned
  }

  const unit  = isRun ? 'spm' : 'rpm'
  const svals = data.map(d => d.spm).filter(Boolean)
  const minS  = Math.min(...svals) - 5
  const maxS  = Math.max(...svals) + 5
  const avgS  = Math.round(svals.reduce((a, b) => a + b, 0) / svals.length)

  const CustomTooltip = ({ active, payload, label }) => {
    if (!active || !payload?.[0]) return null
    return (
      <div className="bg-white border border-gray-200 rounded-xl shadow-md px-3 py-2 text-xs">
        <p className="font-bold text-gray-900">km {label}</p>
        <p className="text-violet-600">{payload[0].value} {unit}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2">
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('strava.extras.cadence')}</p>
        <p className="text-xs text-gray-400 mt-0.5">{t('strava.charts.avg', { val: avgS, unit })}</p>
      </div>
      <ResponsiveContainer width="100%" height={data.length > 30 ? 160 : 140}>
        <ComposedChart data={data} margin={{ top: 4, right: 8, left: -8, bottom: data.length > 15 ? 16 : 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false} />
          <XAxis
            dataKey="km"
            tick={{ fontSize: data.length > 20 ? 8 : 10, fill: '#9ca3af', angle: data.length > 20 ? -45 : 0, textAnchor: data.length > 20 ? 'end' : 'middle', dy: data.length > 20 ? 4 : 0 }}
            tickLine={false}
            axisLine={false}
            interval={data.length > 40 ? 1 : 0}
          />
          <YAxis
            domain={[minS, maxS]}
            tick={{ fontSize: 10, fill: '#9ca3af' }}
            tickLine={false}
            axisLine={false}
            width={42}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine
            y={avgS}
            stroke="#8b5cf6"
            strokeDasharray="4 3"
            strokeWidth={1}
          />
          <Bar dataKey="spm" fill="#8b5cf6" fillOpacity={0.75} radius={[3, 3, 0, 0]} maxBarSize={32} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Splits table (kept for toggle)
// ---------------------------------------------------------------------------

function SplitsTable({ splits, sportType }) {
  const { t } = useTranslation('workouts')
  const isRun = isRunSport(sportType)
  if (!splits || splits.length === 0) return null

  return (
    <div className="mt-3">
      <div className="overflow-x-auto -mx-1">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-gray-400">
              <th className="text-left px-1 pb-1.5 font-medium w-8">{t('strava.cols.km')}</th>
              <th className="text-right px-1 pb-1.5 font-medium">
                {isRun ? t('strava.cols.pace') : t('strava.cols.speed')}
              </th>
              {isRun && (
                <th className="text-right px-1 pb-1.5 font-medium hidden sm:table-cell">
                  {t('strava.cols.gap')}
                </th>
              )}
              <th className="text-right px-1 pb-1.5 font-medium">{t('strava.cols.hr')}</th>
              <th className="text-right px-1 pb-1.5 font-medium">{t('strava.cols.elev')}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {splits.map((s, i) => {
              const hr = s.average_heartrate ? Math.round(s.average_heartrate) : null
              const elev = s.elevation_difference
              const elevSign = elev > 0 ? '+' : ''
              const isLast = i === splits.length - 1
              const distLabel = isLast && s.distance < 950 ? `${(s.distance / 1000).toFixed(2)}` : `${s.split}`
              const speed = s.average_speed || 0
              const speeds = splits.map(x => x.average_speed || 0).filter(Boolean)
              const minSpd = Math.min(...speeds), maxSpd = Math.max(...speeds)
              const relSpd = speeds.length > 1 && maxSpd > minSpd
                ? (speed - minSpd) / (maxSpd - minSpd) : 0.5
              const paceColor = isRun
                ? relSpd > 0.66 ? 'text-green-700' : relSpd > 0.33 ? 'text-gray-700' : 'text-red-600'
                : 'text-gray-700'

              return (
                <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/60'}>
                  <td className="px-1 py-1.5 font-mono text-gray-500">{distLabel}</td>
                  <td className={`px-1 py-1.5 font-mono font-semibold text-right ${paceColor}`}>
                    {isRun ? fmtPace(speed) : fmtSpeed(speed)}
                  </td>
                  {isRun && (
                    <td className="px-1 py-1.5 font-mono text-right text-gray-400 hidden sm:table-cell">
                      {s.average_grade_adjusted_speed ? fmtPace(s.average_grade_adjusted_speed) : '—'}
                    </td>
                  )}
                  <td className="px-1 py-1.5 font-mono text-right text-rose-600">
                    {hr ? `${hr}` : '—'}
                  </td>
                  <td className={`px-1 py-1.5 font-mono text-right ${elev > 0 ? 'text-orange-600' : elev < -1 ? 'text-blue-500' : 'text-gray-400'}`}>
                    {elev != null ? `${elevSign}${Math.round(elev)}` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {isRun && (
          <p className="text-[10px] text-gray-400 mt-1.5 px-1">{t('strava.gapNote')}</p>
        )}
      </div>
    </div>
  )
}

function LapsTable({ laps, sportType }) {
  const { t } = useTranslation('workouts')
  if (!laps || laps.length <= 1) return null
  const isRun = isRunSport(sportType)

  return (
    <div>
      <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
        {t('strava.laps', { count: laps.length })}
      </p>
      <div className="space-y-1.5">
        {laps.map((lap, i) => {
          const distKm = lap.distance ? (lap.distance / 1000).toFixed(2) : '—'
          const speed = isRun ? fmtPace(lap.average_speed) : fmtSpeed(lap.average_speed)
          const hr = lap.average_heartrate ? Math.round(lap.average_heartrate) : null
          const watts = lap.average_watts ? Math.round(lap.average_watts) : null
          return (
            <div key={i} className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2">
              <span className="text-xs font-bold text-gray-400 w-5 shrink-0">{i + 1}</span>
              <span className="text-xs text-gray-500 w-12">{fmtDuration(lap.moving_time)}</span>
              <span className="text-xs text-gray-500 w-12">{distKm} km</span>
              <span className="text-xs font-semibold text-gray-700 flex-1">{speed}</span>
              {hr && <span className="text-xs text-rose-600">{hr} bpm</span>}
              {watts && <span className="text-xs text-purple-600">{watts}W</span>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StravaLogo() {
  return (
    <svg viewBox="0 0 24 24" className="w-5 h-5 shrink-0" fill="none">
      <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066z" fill="#FC4C02"/>
      <path d="M11.587 13.828L9.5 9.713 7.41 13.828H3.344l6.156-12.171 6.154 12.171z" fill="#FC4C02" opacity=".6"/>
    </svg>
  )
}

function StravaAnalysis({ workoutId, sport, maxHr }) {
  const { t } = useTranslation('workouts')
  const { data, isLoading, isError } = useQuery({
    queryKey: ['strava-analysis', workoutId],
    queryFn: () => api.get(`/api/workouts/${workoutId}/strava-analysis`).then(r => r.data),
    retry: false,
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-4">
        <div className="flex items-center gap-2 mb-4">
          <StravaLogo />
          <span className="text-sm font-semibold text-gray-700">{t('strava.loading')}</span>
        </div>
        <div className="space-y-2">
          {[1,2,3].map(i => <div key={i} className="h-4 bg-gray-100 rounded animate-pulse" />)}
        </div>
      </div>
    )
  }

  if (isError || !data) return null

  const hrZone  = data.zones?.find(z => z.type === 'heartrate')
  const pwrZone = data.zones?.find(z => z.type === 'power')
  const isRun   = isRunSport(data.sport_type || sport)
  const streams = data.streams || {}

  const extras = [
    data.total_elevation_gain != null && { label: t('strava.extras.elevation'), value: `${Math.round(data.total_elevation_gain)} m ↑` },
    data.average_cadence      != null && { label: t('strava.extras.cadence'),   value: `${Math.round(data.average_cadence * (isRun ? 2 : 1))} ${isRun ? 'spm' : 'rpm'}` },
    data.weighted_average_watts != null && data.device_watts && { label: t('strava.extras.normPower'), value: `${Math.round(data.weighted_average_watts)} W` },
    data.max_watts            != null && data.device_watts && { label: t('strava.extras.maxPower'),  value: `${Math.round(data.max_watts)} W` },
    data.kilojoules           != null && { label: t('strava.extras.energy'),    value: `${Math.round(data.kilojoules)} kJ` },
    data.suffer_score         != null && { label: t('strava.extras.relEffort'), value: data.suffer_score },
    data.average_temp         != null && { label: t('strava.extras.avgTemp'),   value: `${data.average_temp}°C` },
    data.pr_count             > 0     && { label: t('strava.extras.segmentPrs'),value: `🏆 ${data.pr_count}` },
    data.kudos_count          > 0     && { label: t('strava.extras.kudos'),     value: `👍 ${data.kudos_count}` },
  ].filter(Boolean)

  const hasSplits  = data.splits_metric?.length > 0
  const hasLaps    = data.laps?.length > 1
  const hasZones   = hrZone?.distribution_buckets?.length > 0 || pwrZone?.distribution_buckets?.length > 0
  const hasStreams  = Object.keys(streams).length > 0

  if (!hasSplits && !hasLaps && !hasZones && !hasStreams && extras.length === 0) return null

  return (
    <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
      <div className="px-4 pt-4 pb-3 flex items-center gap-2.5 border-b border-gray-50">
        <StravaLogo />
        <div>
          <h2 className="font-semibold text-gray-900 text-sm leading-tight">{t('strava.analysis')}</h2>
          {data.name && <p className="text-xs text-gray-400 truncate max-w-[220px]">{data.name}</p>}
        </div>
        <a
          href={`https://www.strava.com/activities/${data.activity_id}`}
          target="_blank" rel="noopener noreferrer"
          className="ml-auto text-xs text-orange-500 font-medium"
        >
          {t('strava.viewActivity')}
        </a>
      </div>

      <div className="px-4 pb-5 pt-3 space-y-5">
        {/* Route map */}
        {data.map_polyline && (
          <RouteMap polyline={data.map_polyline} activityId={data.activity_id} />
        )}

        {/* Summary stats */}
        {extras.length > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-2">
            {extras.map(e => (
              <div key={e.label} className="bg-gray-50 rounded-xl p-2.5 text-center">
                <p className="text-sm font-bold text-gray-900">{e.value}</p>
                <p className="text-[10px] text-gray-500 mt-0.5">{e.label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Synced HR + Speed pair — hover on one highlights both */}
        {(streams.heartrate || streams.velocity_smooth) && (
          <div className="space-y-1">
            {streams.heartrate && (
              <HRStreamChart
                streams={streams}
                maxHr={maxHr}
                avgHr={data.zones?.find(z => z.type === 'heartrate')?.average_heartrate
                  ?? (data.splits_metric?.length
                    ? Math.round(data.splits_metric.reduce((s, x) => s + (x.average_heartrate || 0), 0) / data.splits_metric.filter(x => x.average_heartrate).length)
                    : null)}
              />
            )}
            {streams.velocity_smooth && (
              <SpeedStreamChart streams={streams} isRun={isRun} />
            )}
            {(streams.heartrate || streams.velocity_smooth) && (
              <p className="text-[10px] text-gray-400 text-center">
                Hover either chart to see HR + {isRun ? 'pace' : 'speed'} at the same instant
              </p>
            )}
          </div>
        )}

        {/* Peak Moments */}
        <PeakMoments streams={streams} isRun={isRun} maxHr={maxHr} />

        {/* Pace + Cadence side by side on sm+ */}
        {(hasSplits || streams.cadence) && (
          <div className={`grid gap-5 ${streams.cadence && hasSplits ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            {hasSplits && (
              <PaceBarChart
                splits={data.splits_metric}
                sportType={data.sport_type || sport}
                showTableToggle
              />
            )}
            {streams.cadence && (
              <CadenceChart
                streams={streams}
                splits={data.splits_metric}
                isRun={isRun}
              />
            )}
          </div>
        )}

        {/* Elevation profile — full width */}
        {streams.altitude && (
          <ElevationChart streams={streams} />
        )}

        {/* Zone distribution summaries */}
        {hrZone?.distribution_buckets?.length > 0 && (
          <ZoneBar label={t('strava.hrZones')} buckets={hrZone.distribution_buckets} unit="bpm" />
        )}
        {pwrZone?.distribution_buckets?.length > 0 && (
          <ZoneBar label={t('strava.powerZones')} buckets={pwrZone.distribution_buckets} unit="W" />
        )}

        {/* Laps */}
        {hasLaps && (
          <LapsTable laps={data.laps} sportType={data.sport_type || sport} />
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function WorkoutDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { t, i18n } = useTranslation('workouts')
  const { t: tc } = useTranslation('common')
  const { t: td } = useTranslation('dashboard')
  const [logging, setLogging] = useState(false)
  const [logData, setLogData] = useState({
    actual_duration_min: '', actual_distance_km: '',
    avg_hr: '', max_hr: '', perceived_effort: '', notes: '',
  })

  const { data: workout, isLoading } = useQuery({
    queryKey: ['workout', id],
    queryFn: () => api.get(`/api/workouts/${id}`).then(r => r.data),
  })

  const { data: profile = {} } = useQuery({
    queryKey: ['profile'],
    queryFn: () => api.get('/api/profile').then(r => r.data),
  })

  const logMutation = useMutation({
    mutationFn: (d) => api.post(`/api/workouts/${id}/log`, d),
    onSuccess: () => {
      toast.success(t('saveLog'))
      qc.invalidateQueries(['workout', id])
      qc.invalidateQueries(['plan-days'])
      setLogging(false)
    },
    onError: () => toast.error(tc('error')),
  })

  if (isLoading) return <div className="flex items-center justify-center h-screen"><div className="animate-spin h-8 w-8 border-b-2 border-primary-600 rounded-full" /></div>
  if (!workout) return null

  const zoneNum = workout.intensity_zone || 2
  const zoneColor = ['','bg-green-100 text-green-700','bg-green-200 text-green-800','bg-yellow-100 text-yellow-700','bg-orange-100 text-orange-700','bg-red-100 text-red-700'][zoneNum] || 'bg-gray-100 text-gray-700'
  const isLogged = !!workout.log_id
  const isStrava = workout.log_source === 'strava'

  return (
    <div className="min-h-screen bg-gray-50 pb-6">
      <div className="bg-white border-b border-gray-200 px-4 lg:px-6 pt-12 pb-4">
        <button onClick={() => navigate(-1)} className="text-primary-600 text-sm font-medium mb-2">
          {tc('back')}
        </button>
        <div className="flex items-center gap-3">
          <SportBadge sport={workout.sport} size="lg" />
          <div>
            <h1 className="text-xl font-bold text-gray-900">
              {workout.title_key ? t(`titles.${workout.title_key}`, workout.title) : workout.title}
            </h1>
            <p className="text-gray-500 text-sm">
              {td(`dayTypes.${workout.day_type}`, workout.day_type)} · {new Date(workout.date+'T00:00:00').toLocaleDateString(undefined, {weekday:'long',month:'short',day:'numeric'})}
            </p>
          </div>
          {isLogged && (
            <span className="ml-auto bg-green-100 text-green-700 text-xs font-medium px-2 py-1 rounded-full">
              {t('completed')}
            </span>
          )}
        </div>
      </div>

      <div className="px-4 lg:px-6 mt-4 space-y-4 max-w-5xl mx-auto">
        {/* Planned */}
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <h2 className="font-semibold text-gray-900 mb-3">{t('planned')}</h2>
          <div className="grid grid-cols-3 gap-3">
            <Metric label={t('fields.duration')} value={workout.duration_min ? `${workout.duration_min} min` : '—'} />
            <Metric label={t('fields.distance')} value={workout.distance_km ? `${workout.distance_km} km` : '—'} />
            <Metric label={t('fields.tss')} value={workout.tss || '—'} />
          </div>
          <div className={`mt-3 px-3 py-2 rounded-xl text-sm font-medium ${zoneColor}`}>
            Z{zoneNum} — {t(`zones.${zoneNum}.name`)} — {t(`zones.${zoneNum}.desc`)}
          </div>
          {workout.description && (
            <p className="mt-3 text-sm text-gray-600">
              {(workout.description_translations?.[i18n.language]) || workout.description}
            </p>
          )}
          <HRZones maxHr={profile?.max_hr} activeZone={workout.intensity_zone} />
        </div>

        {/* Completed */}
        {isLogged && !logging && (
          <div className="bg-green-50 rounded-2xl border border-green-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold text-gray-900">{t('completedLabel')}</h2>
              {isStrava && (
                <span className="flex items-center gap-1 text-xs text-orange-500 font-medium">
                  <StravaLogo /> {t('strava.viaStrava')}
                </span>
              )}
            </div>
            <div className="grid grid-cols-3 gap-3">
              <Metric label={t('fields.duration')} value={workout.actual_duration_min ? `${workout.actual_duration_min} min` : '—'} />
              <Metric label={t('fields.distance')} value={workout.actual_distance_km ? `${workout.actual_distance_km} km` : '—'} />
              <Metric label={t('fields.avgHr')} value={workout.avg_hr ? `${workout.avg_hr} bpm` : '—'} />
              <Metric label={t('fields.maxHr')} value={workout.max_hr ? `${workout.max_hr} bpm` : '—'} />
              <Metric label={t('fields.rpe')} value={workout.perceived_effort ? `${workout.perceived_effort}/10` : '—'} />
              <Metric label={t('fields.calories')} value={workout.calories_burned ? `${workout.calories_burned} kcal` : '—'} />
            </div>
            {workout.log_notes && <p className="mt-2 text-sm text-gray-600">{workout.log_notes}</p>}
            {!isStrava && (
              <button onClick={() => setLogging(true)} className="mt-3 text-sm text-primary-600 font-medium">
                {t('editLog')}
              </button>
            )}
          </div>
        )}

        {/* Strava rich analysis */}
        {isStrava && isLogged && (
          <StravaAnalysis workoutId={id} sport={workout.sport} maxHr={profile?.max_hr} />
        )}

        {/* Manual log form */}
        {!isStrava && (logging || !isLogged) && workout.sport !== 'rest' && (
          <div className="bg-white rounded-2xl border border-gray-100 p-4">
            <h2 className="font-semibold text-gray-900 mb-3">{t('logWorkout')}</h2>
            <div className="space-y-3">
              <LogField label={t('fields.durationMin')} type="number" value={logData.actual_duration_min} onChange={v => setLogData(p => ({...p, actual_duration_min: v}))} placeholder={workout.duration_min} />
              <LogField label={t('fields.distanceKm')} type="number" value={logData.actual_distance_km} onChange={v => setLogData(p => ({...p, actual_distance_km: v}))} placeholder={workout.distance_km} />
              <div className="grid grid-cols-2 gap-3">
                <LogField label={t('fields.avgHrBpm')} type="number" value={logData.avg_hr} onChange={v => setLogData(p => ({...p, avg_hr: v}))} placeholder="145" />
                <LogField label={t('fields.maxHrBpm')} type="number" value={logData.max_hr} onChange={v => setLogData(p => ({...p, max_hr: v}))} placeholder="165" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">{t('fields.perceivedEffort')}</label>
                <div className="flex gap-1">
                  {[1,2,3,4,5,6,7,8,9,10].map(n => (
                    <button key={n} onClick={() => setLogData(p => ({...p, perceived_effort: n}))}
                      className={`flex-1 py-2 text-xs rounded-lg font-medium ${logData.perceived_effort===n ? 'bg-primary-600 text-white' : 'bg-gray-100 text-gray-700'}`}>
                      {n}
                    </button>
                  ))}
                </div>
              </div>
              <LogField label={t('fields.notes')} value={logData.notes} onChange={v => setLogData(p => ({...p, notes: v}))} placeholder={t('fields.notesPlaceholder')} />
            </div>
            <div className="flex gap-2 mt-4">
              {logging && (
                <button onClick={() => setLogging(false)} className="flex-1 py-2.5 rounded-xl border border-gray-300 text-gray-700 font-medium">
                  {tc('cancel')}
                </button>
              )}
              <button
                onClick={() => logMutation.mutate(logData)}
                disabled={logMutation.isPending}
                className="flex-1 py-2.5 rounded-xl bg-primary-600 text-white font-medium active:bg-primary-700 disabled:opacity-50"
              >
                {logMutation.isPending ? tc('saving') : t('saveLog')}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function Metric({ label, value }) {
  return (
    <div className="text-center">
      <p className="text-lg font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500">{label}</p>
    </div>
  )
}

function LogField({ label, value, onChange, type = 'text', placeholder = '' }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder}
        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-gray-900 focus:outline-none focus:ring-2 focus:ring-primary-500 bg-white" />
    </div>
  )
}
