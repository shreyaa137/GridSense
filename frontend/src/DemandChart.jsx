import { useState, useEffect } from 'react'
import { ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { getLocations, getDayForecast, getDayAnomalies, getDaySummary, errorMessage } from './api'
import ExplainPanel from './ExplainPanel'
import WhatifPanel from './WhatifPanel'
import SummaryPanel from './SummaryPanel'
import AccuracyPanel from './AccuracyPanel'
import Panel from './Panel'
import { PRIMARY, PRIMARY_SOFT, HIGHLIGHT, SIGNAL, INK, INK_SOFT, LINE, TICK } from './theme'


const WEATHER_NOTES = {
  dataset: 'Weather from the training dataset',
  archive: 'Recorded weather from Open-Meteo',
  forecast: 'Live weather forecast from Open-Meteo',
}

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  const point = payload[0].payload
  return (
    <div className="bg-card border border-line rounded-lg shadow-md px-3 py-2 text-xs leading-relaxed">
      <p className="font-semibold">{String(label).padStart(2, '0')}:00</p>
      <p>forecast {point.predicted_demand_gw} GW</p>
      <p className="text-ink-soft">range {point.lower_gw} to {point.upper_gw} GW</p>
      {point.actual_demand_gw !== null && <p>actual {point.actual_demand_gw} GW</p>}
      <p className="text-ink-soft">{point.temperature}°C</p>
      {point.is_anomaly && <p className="text-signal">unusual for this weekday</p>}
    </div>
  )
}

function DemandChart() {
  const [locations, setLocations] = useState([])
  const [location, setLocation] = useState('')
  const [date, setDate] = useState('2024-03-15')
  const [forecast, setForecast] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [selectedHour, setSelectedHour] = useState(null)

  useEffect(() => {
    getLocations()
      .then((locs) => {
        setLocations(locs)
        setLocation(locs.includes('National') ? 'National' : locs[0])
      })
      .catch((err) => setError(errorMessage(err, 'Could not load regions.')))
  }, [])

  useEffect(() => {
    if (!location || !date) return
    let stale = false

    setLoading(true)
    setError(null)
    setSelectedHour(null)

    Promise.all([
      getDayForecast(location, date),
      getDayAnomalies(location, date),
      getDaySummary(location, date),
    ])
      .then(([dayForecast, hourlyAnomalies, daySummary]) => {
        if (stale) return
        setForecast({
          ...dayForecast,
          hours: dayForecast.hourly_forecast.map((point, i) => ({
            ...point,
            band: [point.lower_gw, point.upper_gw],
            is_anomaly: hourlyAnomalies[i].is_anomaly,
          })),
        })
        setSummary(daySummary)
      })
      .catch((err) => {
        if (stale) return
        setForecast(null)
        setSummary(null)
        setError(errorMessage(err, 'Could not load forecast.'))
      })
      .finally(() => !stale && setLoading(false))

    return () => { stale = true }
  }, [location, date])

  const handleChartClick = (chartEvent) => {
    if (chartEvent && chartEvent.activeLabel !== undefined) {
      setSelectedHour(Number(chartEvent.activeLabel))
    }
  }

  const hours = forecast?.hours ?? []
  const hasActuals = hours.some((h) => h.actual_demand_gw !== null)
  const ready = !loading && !error && hours.length > 0

  return (
    <div className="min-h-screen p-4 sm:p-8 max-w-5xl mx-auto">
      <header className="pb-5 mb-6 border-b border-line flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight"><span className="inline-block w-2.5 h-2.5 rounded-full bg-primary mr-2 align-middle"></span>GridSense</h1>
          <p className="text-xs text-ink-soft mt-1">Hourly electricity demand forecasts for India's grid</p>
        </div>
        <div className="text-xs text-ink-soft text-right leading-relaxed">
          <p>{location || 'Loading region'}</p>
          <p>{date}</p>
        </div>
      </header>

      <div className="flex flex-wrap gap-6 mb-8">
        <label className="block">
          <span className="block text-xs font-medium text-ink-soft mb-1">Region</span>
          <select
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className="bg-card border border-line px-3 py-2 rounded-lg text-sm focus:border-primary focus:ring-2 focus:ring-primary-soft outline-none"
          >
            {locations.map((loc) => (
              <option key={loc} value={loc}>{loc}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="block text-xs font-medium text-ink-soft mb-1">Date</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="bg-card border border-line px-3 py-2 rounded-lg text-sm focus:border-primary focus:ring-2 focus:ring-primary-soft outline-none"
          />
        </label>
      </div>

      {loading && <p className="text-ink-soft text-sm">Loading forecast…</p>}
      {error && <p className="text-signal text-sm">{error}</p>}

      {ready && (
        <div className="space-y-8">
          <SummaryPanel summary={summary} />

          <Panel title="24-hour demand forecast" meta={WEATHER_NOTES[forecast.weather_source]}>
            <p className="text-xs text-ink-soft mb-3 flex flex-wrap gap-x-5 gap-y-1">
              <span><span className="inline-block w-4 border-t-2 border-primary align-middle mr-1"></span>forecast</span>
              <span><span className="inline-block w-4 h-2.5 bg-primary-soft align-middle mr-1"></span>{forecast.band_coverage_pct}% range</span>
              {hasActuals && (
                <span><span className="inline-block w-4 border-t-2 border-dashed border-ink align-middle mr-1"></span>actual</span>
              )}
              {hours.some((h) => h.is_anomaly) && (
                <span><span className="inline-block w-2 h-2 rounded-full bg-signal align-middle mr-1"></span>unusual for this weekday</span>
              )}
            </p>
            <ResponsiveContainer width="100%" height={380}>
              <ComposedChart data={hours} onClick={handleChartClick} margin={{ top: 5, right: 5, bottom: 18, left: 0 }}>
                <CartesianGrid stroke={LINE} />
                <XAxis dataKey="hour" stroke={LINE} tick={TICK} label={{ value: 'Hour (click a point for details)', position: 'insideBottom', offset: -5, fill: INK_SOFT, fontSize: 12 }} />
                <YAxis stroke={LINE} tick={TICK} domain={['auto', 'auto']} label={{ value: 'Demand (GW)', angle: -90, position: 'insideLeft', fill: INK_SOFT, fontSize: 12 }} />
                <Tooltip content={<ChartTooltip />} />
                <Area type="monotone" dataKey="band" stroke="none" fill={PRIMARY_SOFT} fillOpacity={0.7} isAnimationActive={false} activeDot={false} />
                {hasActuals && (
                  <Line type="monotone" dataKey="actual_demand_gw" stroke={INK} strokeWidth={1.5} strokeDasharray="5 4" dot={false} activeDot={false} isAnimationActive={false} />
                )}
                <Line
                  type="monotone"
                  dataKey="predicted_demand_gw"
                  stroke={PRIMARY}
                  strokeWidth={2.5}
                  isAnimationActive={false}
                  dot={(props) => {
                    const { cx, cy, payload } = props
                    const selected = payload.hour === selectedHour
                    return (
                      <circle
                        key={`dot-${payload.hour}`}
                        cx={cx}
                        cy={cy}
                        r={selected || payload.is_anomaly ? 6 : 3}
                        fill={payload.is_anomaly ? SIGNAL : selected ? HIGHLIGHT : PRIMARY}
                        stroke={selected || payload.is_anomaly ? '#FFFFFF' : 'none'}
                        strokeWidth={selected || payload.is_anomaly ? 2 : 0}
                        cursor="pointer"
                      />
                    )
                  }}
                  activeDot={{ r: 6 }}
                />
              </ComposedChart>
            </ResponsiveContainer>
            {forecast.in_training_data && (
              <p className="text-xs text-ink-soft mt-2">
                This date is in the training data, so the fit here flatters the model. Held-out accuracy is below.
              </p>
            )}
          </Panel>

          <ExplainPanel location={location} date={date} hour={selectedHour} />
          <WhatifPanel location={location} date={date} hour={selectedHour} />
        </div>
      )}

      {location && (
        <div className="mt-8">
          <AccuracyPanel location={location} />
        </div>
      )}
    </div>
  )
}

export default DemandChart
