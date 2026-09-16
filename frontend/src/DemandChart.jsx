import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getLocations, getDayForecast, getDayAnomalies } from './api'
import ExplainPanel from './ExplainPanel'
import WhatifPanel from './WhatifPanel'

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
    setSelectedHour(null) // reset selection when location/date changes

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
    <div className="min-h-screen bg-slate-900 text-white p-8">
      <h1 className="text-3xl font-bold mb-6">GridSense — 24-Hour Demand Forecast</h1>

      <div className="flex gap-4 mb-6">
        <select
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-2"
        >
          {locations.map((loc) => (
            <option key={loc} value={loc}>{loc}</option>
          ))}
        </select>

        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-2"
        />
      </div>

      {loading && <p className="text-slate-400">Loading forecast...</p>}
      {error && <p className="text-red-400">{error}</p>}

      {!loading && !error && data.length > 0 && (
        <>
          <ResponsiveContainer width="100%" height={400}>
            <LineChart data={data} onClick={handleChartClick}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="hour" stroke="#94a3b8" label={{ value: 'Hour (click a point)', position: 'insideBottom', offset: -5 }} />
              <YAxis stroke="#94a3b8" label={{ value: 'Demand (GW)', angle: -90, position: 'insideLeft' }} />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
              <Line
                type="monotone"
                dataKey="predicted_demand_gw"
                stroke="#38bdf8"
                strokeWidth={2}
                dot={(props) => {
                  const { cx, cy, payload } = props
                  return (
                    <circle
                      key={`dot-${payload.hour}`}
                      cx={cx}
                      cy={cy}
                      r={payload.is_anomaly ? 6 : 3}
                      fill={payload.is_anomaly ? '#f87171' : '#38bdf8'}
                      stroke={payload.is_anomaly ? '#f87171' : 'none'}
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
            <p className="text-sm text-slate-400 mt-2">
              <span className="inline-block w-2 h-2 rounded-full bg-red-400 mr-1"></span>
              Red points indicate anomalous demand (z-score beyond threshold)
            </p>
          )}
        </>
      )}

      {!loading && !error && data.length > 0 && (
        <ExplainPanel location={location} date={date} hour={selectedHour} />
      )}

      {!loading && !error && data.length > 0 && (
        <WhatifPanel location={location} date={date} hour={selectedHour} />
      )}
    </div>
  )
}

export default DemandChart