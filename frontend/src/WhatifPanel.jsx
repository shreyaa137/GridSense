import { useState, useEffect } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getWhatif } from './api'
import Panel from './Panel'

const HAZARD = '#E8622C'
const SIGNAL = '#D1373F'
const INK = '#1B2A4A'
const INK_SOFT = '#5B6B84'
const PAPER_LINE = '#D8E0E7'

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
      <Panel title="what-if simulation">
        <p className="text-ink-soft font-mono text-sm">select an hour above to try a simulation</p>
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
    <Panel title="what-if simulation" meta={`hour ${hour}`}>
      <div className="flex flex-wrap items-center gap-4 mb-4">
        <select
          value={feature}
          onChange={(e) => setFeature(e.target.value)}
          className="bg-paper border border-ink/40 px-3 py-2 font-display focus:border-hazard outline-none"
        >
          <option value="temperature">temperature</option>
          <option value="humidity">humidity</option>
          <option value="is_holiday">holiday flag</option>
        </select>

        {feature === 'is_holiday' ? (
          <select
            value={delta}
            onChange={(e) => setDelta(Number(e.target.value))}
            className="bg-paper border border-ink/40 px-3 py-2 font-display focus:border-hazard outline-none"
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
              className="w-48 accent-hazard"
            />
            <span className="w-16 text-center font-mono text-sm">
              {delta > 0 ? `+${delta}` : delta}
              {feature === 'temperature' ? '°C' : '%'}
            </span>
          </div>
        )}

        <button
          onClick={runWhatif}
          disabled={loading}
          className="bg-hazard text-paper border border-ink px-4 py-2 font-display font-semibold hover:bg-ink disabled:bg-ink-soft transition-colors"
        >
          {loading ? 'running...' : 'run simulation'}
        </button>
      </div>

      {error && <p className="text-signal font-mono text-sm">{error}</p>}

      {result && (
        <div>
          <p className="mb-3 font-mono text-sm text-ink-soft">
            {result.change_gw >= 0 ? 'demand increases by ' : 'demand decreases by '}
            <span className={result.change_gw >= 0 ? 'text-signal font-semibold' : 'text-hazard font-semibold'}>
              {Math.abs(result.change_gw)} GW
            </span>
            {' '}({result.original_prediction_gw} → {result.new_prediction_gw} GW)
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={chartData}>
              <CartesianGrid stroke={PAPER_LINE} />
              <XAxis dataKey="name" stroke={INK_SOFT} tick={{ fontFamily: 'JetBrains Mono', fontSize: 12 }} />
              <YAxis stroke={INK_SOFT} tick={{ fontFamily: 'JetBrains Mono', fontSize: 12 }} />
              <Tooltip contentStyle={{ backgroundColor: '#EFF3F6', border: `1px solid ${INK}`, borderRadius: 0, fontFamily: 'JetBrains Mono', fontSize: 12 }} />
              <Bar dataKey="demand" fill={HAZARD} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  )
}

export default WhatifPanel