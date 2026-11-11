import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getWhatif } from './api'
import Panel from './Panel'
import { PRIMARY, LINE, TICK, TOOLTIP_STYLE } from './theme'


function WhatifPanel({ location, date, hour }) {
  const [feature, setFeature] = useState('temperature')
  const [delta, setDelta] = useState(0)
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

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
    return (
      <Panel title="What-if simulation">
        <p className="text-ink-soft text-sm">Select an hour on the chart to try a simulation.</p>
      </Panel>
    )
  }

  const chartData = result
    ? [
        { name: 'original', demand: result.original_prediction_gw },
        { name: 'modified', demand: result.new_prediction_gw },
      ]
    : []

  return (
    <Panel title="What-if simulation" meta={`hour ${hour}`}>
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <select
          value={feature}
          onChange={(e) => setFeature(e.target.value)}
          className="bg-card border border-line px-3 py-2 rounded-lg text-sm focus:border-primary focus:ring-2 focus:ring-primary-soft outline-none"
        >
          <option value="temperature">temperature</option>
          <option value="humidity">humidity</option>
          <option value="is_holiday">holiday flag</option>
        </select>

        {feature === 'is_holiday' ? (
          <select
            value={delta}
            onChange={(e) => setDelta(Number(e.target.value))}
            className="bg-card border border-line px-3 py-2 rounded-lg text-sm focus:border-primary focus:ring-2 focus:ring-primary-soft outline-none"
          >
            <option value={1}>make it a holiday</option>
            <option value={-1}>make it a normal day</option>
          </select>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="range"
              min={-10}
              max={10}
              value={delta}
              onChange={(e) => setDelta(Number(e.target.value))}
              className="w-48 accent-primary"
            />
            <span className="w-16 text-center text-sm font-mono">
              {delta > 0 ? `+${delta}` : delta}
              {feature === 'temperature' ? '°C' : '%'}
            </span>
          </div>
        )}

        <button
          onClick={runWhatif}
          disabled={loading}
          className="bg-primary text-white rounded-lg px-4 py-2 text-sm font-semibold hover:bg-primary-dark disabled:bg-ink-soft transition-colors cursor-pointer"
        >
          {loading ? 'Running…' : 'Run simulation'}
        </button>
      </div>

      {error && <p className="text-signal text-sm">{error}</p>}

      {result && (
        <div>
          <p className="mb-3 text-sm text-ink-soft">
            {result.change_gw >= 0 ? 'Demand increases by ' : 'Demand decreases by '}
            <span className={result.change_gw >= 0 ? 'text-signal font-semibold' : 'text-primary-dark font-semibold'}>
              {Math.abs(result.change_gw)} GW
            </span>
            {' '}({result.original_prediction_gw} → {result.new_prediction_gw} GW)
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData}>
              <CartesianGrid stroke={LINE} />
              <XAxis dataKey="name" stroke={LINE} tick={TICK} />
              <YAxis stroke={LINE} tick={TICK} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: '#EFF6FF' }} />
              <Bar dataKey="demand" fill={PRIMARY} radius={[4, 4, 0, 0]} maxBarSize={120} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  )
}

export default WhatifPanel