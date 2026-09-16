import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getWhatif } from './api'

function WhatifPanel({ location, date, hour }) {
  const [feature, setFeature] = useState('temperature')
  const [delta, setDelta] = useState(0)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  // reset delta and result when the user picks a different hour
  useEffect(() => {
    setDelta(0)
    setResult(null)
  }, [hour])

  const runWhatif = () => {
    if (hour === null) return
    const targetDatetime = `${date}T${String(hour).padStart(2, '0')}:00:00`

    setLoading(true)
    setError(null)

    getWhatif(location, targetDatetime, feature, delta)
      .then((data) => setResult(data))
      .catch(() => setError('Could not run what-if simulation.'))
      .finally(() => setLoading(false))
  }

  if (hour === null) {
    return <p className="text-slate-500 mt-6">Select an hour above to try a what-if simulation.</p>
  }

  const chartData = result
    ? [
        { name: 'Original', demand: result.original_prediction_gw },
        { name: 'Modified', demand: result.new_prediction_gw },
      ]
    : []

  return (
    <div className="mt-8">
      <h2 className="text-xl font-semibold mb-3">What-If Simulation — Hour {hour}</h2>

      <div className="flex flex-wrap items-center gap-4 mb-4">
        <select
          value={feature}
          onChange={(e) => setFeature(e.target.value)}
          className="bg-slate-800 border border-slate-700 rounded px-3 py-2"
        >
          <option value="temperature">Temperature</option>
          <option value="humidity">Humidity</option>
          <option value="is_holiday">Holiday flag</option>
        </select>

        {feature === 'is_holiday' ? (
          <select
            value={delta}
            onChange={(e) => setDelta(Number(e.target.value))}
            className="bg-slate-800 border border-slate-700 rounded px-3 py-2"
          >
            <option value={1}>Make it a holiday</option>
            <option value={-1}>Make it a normal day</option>
          </select>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={-10}
              max={10}
              value={delta}
              onChange={(e) => setDelta(Number(e.target.value))}
              className="w-48"
            />
            <span className="w-16 text-center">
              {delta > 0 ? `+${delta}` : delta}
              {feature === 'temperature' ? '°C' : '%'}
            </span>
          </div>
        )}

        <button
          onClick={runWhatif}
          disabled={loading}
          className="bg-sky-600 hover:bg-sky-500 disabled:bg-slate-700 rounded px-4 py-2 font-medium"
        >
          {loading ? 'Running...' : 'Run Simulation'}
        </button>
      </div>

      {error && <p className="text-red-400">{error}</p>}

      {result && (
        <div>
          <p className="mb-3 text-slate-300">
            {result.change_gw >= 0 ? 'Demand increases by ' : 'Demand decreases by '}
            <span className={result.change_gw >= 0 ? 'text-orange-400 font-semibold' : 'text-sky-400 font-semibold'}>
              {Math.abs(result.change_gw)} GW
            </span>
            {' '}({result.original_prediction_gw} → {result.new_prediction_gw} GW)
          </p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#334155" />
              <XAxis dataKey="name" stroke="#94a3b8" />
              <YAxis stroke="#94a3b8" />
              <Tooltip contentStyle={{ backgroundColor: '#1e293b', border: 'none' }} />
              <Bar dataKey="demand" fill="#38bdf8" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  )
}

export default WhatifPanel