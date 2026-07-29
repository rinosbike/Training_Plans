// Client-side fallback analytics computed from raw stream arrays (time/distance/
// heartrate/altitude), used when the source (manual FIT upload, or a Strava
// activity on a non-Summit account) doesn't already provide splits_metric/zones.
// Shapes match Strava's own schema so the existing ZoneBar/PaceBarChart render
// either source unchanged.

// 5-zone percentage-of-max-HR model, shared with the planned-workout zone display
// in WorkoutDetail.jsx so "target zone" and "actual zone" always agree.
export const HR_ZONE_PCT_BANDS = [
  [0.50, 0.60],
  [0.60, 0.70],
  [0.70, 0.80],
  [0.80, 0.90],
  [0.90, 1.00],
]

export function hrZoneIndex(bpm, maxHr) {
  if (!bpm || !maxHr) return -1
  const pct = bpm / maxHr
  if (pct >= 0.90) return 4
  if (pct >= 0.80) return 3
  if (pct >= 0.70) return 2
  if (pct >= 0.60) return 1
  return 0
}

// Returns Strava zones-endpoint-shaped buckets: [{min, max, time}], max=-1 for the
// open-ended top zone. Weights each heartrate sample by the real elapsed time to
// the next sample (not just sample count), since streams may be unevenly downsampled.
export function computeHrZoneBuckets(streams, maxHr) {
  const hr = streams?.heartrate
  const time = streams?.time
  if (!hr || hr.length < 2 || !maxHr) return []

  const timeByZone = [0, 0, 0, 0, 0]
  for (let i = 1; i < hr.length; i++) {
    const dt = time?.[i] != null && time?.[i - 1] != null ? time[i] - time[i - 1] : 1
    if (dt <= 0) continue
    const zi = hrZoneIndex(hr[i], maxHr)
    if (zi >= 0) timeByZone[zi] += dt
  }
  if (timeByZone.every(t => t === 0)) return []

  return HR_ZONE_PCT_BANDS.map(([lo, hi], i) => ({
    min:  Math.round(lo * maxHr),
    max:  i === HR_ZONE_PCT_BANDS.length - 1 ? -1 : Math.round(hi * maxHr),
    time: Math.round(timeByZone[i]),
  }))
}

// Returns Strava splits_metric-shaped rows: [{split, distance, average_speed,
// average_heartrate, elevation_difference}]. Bins by fixed distance markers
// (1km for run/cycle, 100m for pool swims) so boundaries don't drift on overshoot.
export function computeSplitsFromStreams(streams, sportType) {
  const dist = streams?.distance
  const time = streams?.time
  const hr   = streams?.heartrate
  const alt  = streams?.altitude
  if (!dist || !time || dist.length < 2) return []

  const splitMeters = /swim/i.test(sportType || '') ? 100 : 1000

  const splits = []
  let segStart = 0
  let boundary = splitMeters

  for (let i = 1; i < dist.length; i++) {
    if (dist[i] == null) continue
    const isLast = i === dist.length - 1
    if (dist[i] >= boundary || isLast) {
      const segDist = dist[i] - (dist[segStart] || 0)
      const segTime = time[i] - time[segStart]
      if (segTime > 0 && segDist > 0) {
        const hrSlice  = (hr  || []).slice(segStart, i + 1).filter(v => v != null)
        const altSlice = (alt || []).slice(segStart, i + 1).filter(v => v != null)
        splits.push({
          split:                 splits.length + 1,
          distance:              Math.round(segDist),
          average_speed:         segDist / segTime,
          average_heartrate:     hrSlice.length ? Math.round(hrSlice.reduce((a, b) => a + b, 0) / hrSlice.length) : null,
          elevation_difference:  altSlice.length > 1 ? Math.round(altSlice[altSlice.length - 1] - altSlice[0]) : null,
        })
      }
      segStart = i
      boundary += splitMeters
    }
  }
  return splits
}
