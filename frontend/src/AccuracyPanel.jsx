import { useState, useEffect } from 'react'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getMetrics, getMetricsSeries } from './api'
import Panel from './Panel'
import { PRIMARY, INK, INK_SOFT, LINE, TICK, TOOLTIP_STYLE } from './theme'


const MODEL_NOTES = {
  GridSense: 'This model: needs only a date and weather',
  'Original XGBoost': 'The first version of this project',
  'Same hour last week': "Needs last week's actual demand, so reaches 7 days ahead at most",
  'Typical profile': 'Average for the region, hour and weekday',
}

function AccuracyPanel({ location }) {
  const [metrics, setMetrics] = useState(null)
  const [series, setSeries] = useState([])
  const [error, setError] = useState(false)

  useEffect(() => {
    getMetrics().then(setMetrics).catch(() => setError(true))
  }, [])

  useEffect(() => {
    if (!location) return
    getMetricsSeries(location).then(setSeries).catch(() => setError(true))
  }, [location])

  if (error) return <Panel title="Model accuracy"><p className="text-signal text-sm">Could not load accuracy results.</p></Panel>
  if (!metrics) return null

  const { summary, band, folds } = metrics
  const ours = summary.GridSense
  const original = summary['Original XGBoost']
  const improvement = Math.round((1 - ours.wape_pct / original.wape_pct) * 100)
  const first = folds[0].test_start
  const last = folds[folds.length - 1].test_end

  return (
    <Panel title="Model accuracy" meta={`Held-out data, ${first} to ${last}`}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-6">
        <Stat value={`${ours.wape_pct.toFixed(1)}%`} label="error on demand the model never saw" />
        <Stat value={`${improvement}%`} label="lower error than the original model" />
        <Stat value={`${Math.round(band.calibrated_coverage_pct)}%`} label={`of held-out hours inside the ${band.target_coverage_pct}% range`} />
      </div>

      <table className="w-full text-sm mb-2">
        <thead>
          <tr className="border-b border-line text-xs text-ink-soft text-left">
            <th className="py-2 pl-2 font-normal">Forecast</th>
            <th className="py-2 pl-4 font-normal text-right">Error, all regions</th>
            <th className="py-2 pl-4 font-normal text-right">Error, {location}</th>
            <th className="py-2 pl-4 pr-2 font-normal text-right">MAE</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(summary).map(([name, m]) => (
            <tr key={name} className={`border-b border-line ${name === 'GridSense' ? 'font-semibold bg-primary-tint' : ''}`}>
              <td className="py-2 pl-2 pr-4">
                {name}
                <span className="block text-xs font-normal text-ink-soft">{MODEL_NOTES[name]}</span>
              </td>
              <td className="py-2 pl-4 text-right font-mono align-top whitespace-nowrap">{m.wape_pct.toFixed(1)}%</td>
              <td className="py-2 pl-4 text-right font-mono align-top whitespace-nowrap">{m.wape_by_location[location]?.toFixed(1)}%</td>
              <td className="py-2 pl-4 text-right font-mono align-top whitespace-nowrap pr-2">{m.mae_gw.toFixed(2)} GW</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-ink-soft mb-6 leading-relaxed">
        Error is total absolute error as a share of total demand, averaged over regions and over{' '}
        {folds.length} six-month test windows. Each window is predicted by a model trained only on earlier data.
      </p>

      {series.length > 0 && (
        <>
          <p className="text-xs text-ink-soft mb-2">
            {location}: daily average demand on held-out data
            <span className="ml-4"><span className="inline-block w-4 border-t-2 border-ink align-middle mr-1"></span>actual</span>
            <span className="ml-4"><span className="inline-block w-4 border-t-2 border-primary align-middle mr-1"></span>predicted</span>
          </p>
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={series}>
              <CartesianGrid stroke={LINE} />
              <XAxis dataKey="date" stroke={LINE} tick={TICK} minTickGap={80} tickFormatter={(d) => d.slice(0, 7)} />
              <YAxis stroke={LINE} tick={TICK} domain={['auto', 'auto']} label={{ value: 'GW', angle: -90, position: 'insideLeft', fill: INK_SOFT, fontSize: 12 }} />
              <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v, name) => [`${v} GW`, name]} />
              <Line type="monotone" dataKey="actual_gw" name="actual" stroke={INK} strokeWidth={1.5} dot={false} isAnimationActive={false} />
              <Line type="monotone" dataKey="predicted_gw" name="predicted" stroke={PRIMARY} strokeWidth={1.5} dot={false} isAnimationActive={false} />
            </LineChart>
          </ResponsiveContainer>
        </>
      )}
    </Panel>
  )
}

function Stat({ value, label }) {
  return (
    <div className="rounded-lg bg-primary-tint px-4 py-3">
      <p className="text-3xl font-bold text-primary-dark">{value}</p>
      <p className="text-xs text-ink-soft leading-snug mt-1">{label}</p>
    </div>
  )
}

export default AccuracyPanel
