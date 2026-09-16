import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getLocations, getDayForecast, getDayAnomalies } from './api'
import ExplainPanel from './ExplainPanel'
import WhatifPanel from './WhatifPanel'
import Panel from './Panel'

const HAZARD = '#E8622C'
const SIGNAL = '#D1373F'
const INK = '#1B2A4A'
const INK_SOFT = '#5B6B84'
const PAPER_LINE = '#D8E0E7'

function DemandChart() {
  const [locations, setLocations] = useState([])
  const [location, setLocation] = useState('')
  const [date, setDate] = useState('2024-03-15')
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedHour, setSelectedHour] = useState(null)

  useEffect(() => {
    getLocations().then((locs) => {
      setLocations(locs)
      setLocation(locs[0])
    })
  }, [])

  useEffect(() => {
    if (!location) return

    setLoading(true)
    setError(null)
    setSelectedHour(null)

    Promise.all([
      getDayForecast(location, date),
      getDayAnomalies(location, date),
    ])
      .then(([hourlyForecast, hourlyAnomalies]) => {
        const merged = hourlyForecast.map((point, i) => ({
          ...point,
          is_anomaly: hourlyAnomalies[i].is_anomaly,
        }))
        setData(merged)
      })
      .catch(() => setError('Could not load forecast. Check that the backend is running.'))
      .finally(() => setLoading(false))
  }, [location, date])

  const handleChartClick = (chartEvent) => {
    if (chartEvent && chartEvent.activeLabel !== undefined) {
      setSelectedHour(chartEvent.activeLabel)
    }
  }

  return (
    <div className="min-h-screen p-8 max-w-5xl mx-auto">
      <header className="border-b-2 border-ink pb-4 mb-8 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-3xl font-bold">GridSense</h1>
        <div className="font-mono text-xs text-ink-soft text-right leading-relaxed">
          <p>{location || 'loading region'}</p>
          <p>{date}</p>
        </div>
      </header>

      <div className="flex flex-wrap gap-6 mb-8">
        <label className="block">
          <span className="block font-mono text-xs text-ink-soft mb-1">Region</span>
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="bg-paper border border-ink/40 px-3 py-2 font-display focus:border-hazard outline-none"
          >
            {locations.map((loc) => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block font-mono text-xs text-ink-soft mb-1">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-paper border border-ink/40 px-3 py-2 font-display focus:border-hazard outline-none"
          />
        </label>
      </div>

      {loading && <p className="text-ink-soft font-mono text-sm">loading forecast...</p>}
      {error && <p className="text-signal font-mono text-sm">{error}</p>}

      {!loading && !error && data.length > 0 && (
        <Panel title="24-hour load schedule" meta={`${data.length} points`}>
          <ResponsiveContainer width="100%" height={380}>
            <LineChart data={data} onClick={handleChartClick}>
              <CartesianGrid stroke={PAPER_LINE} />
              <XAxis dataKey="hour" stroke={INK_SOFT} tick={{ fontFamily: 'JetBrains Mono', fontSize: 12 }} label={{ value: 'hour (click a point)', position: 'insideBottom', offset: -5, fill: INK_SOFT, fontSize: 12 }} />
              <YAxis stroke={INK_SOFT} tick={{ fontFamily: 'JetBrains Mono', fontSize: 12 }} label={{ value: 'demand (GW)', angle: -90, position: 'insideLeft', fill: INK_SOFT, fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#EFF3F6', border: `1px solid ${INK}`, borderRadius: 0, fontFamily: 'JetBrains Mono', fontSize: 12 }} />
              <Line
                type="monotone"
                dataKey="predicted_demand_gw"
                stroke={HAZARD}
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, payload } = props
                  return (
                    <circle
                      key={`dot-${payload.hour}`}
                      cx={cx}
                      cy={cy}
                      r={payload.is_anomaly ? 6 : 3}
                      fill={payload.is_anomaly ? SIGNAL : HAZARD}
                      stroke={payload.is_anomaly ? SIGNAL : 'none'}
                      strokeWidth={payload.is_anomaly ? 2 : 0}
                      cursor="pointer"
                    />
                  )
                }}
                activeDot={{ r: 6 }}
              />
            </LineChart>
          </ResponsiveContainer>

          {data.some((d) => d.is_anomaly) && (
            <p className="text-xs font-mono text-ink-soft mt-2">
              <span className="inline-block w-2 h-2 bg-signal mr-1"></span>
              red points mark anomalous demand (z-score beyond threshold)
            </p>
          )}
        </Panel>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="mt-8">
          <ExplainPanel location={location} date={date} hour={selectedHour} />
        </div>
      )}

      {!loading && !error && data.length > 0 && (
        <div className="mt-8">
          <WhatifPanel location={location} date={date} hour={selectedHour} />
        </div>
      )}
    </div>
  )
}

export default DemandChart