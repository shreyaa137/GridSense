from datetime import date as date_type, datetime, timedelta
from pathlib import Path
import json
import os
import time

import holidays
import numpy as np
import pandas as pd
import requests
import shap
import xgboost as xgb
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from features import BASE_FEATURES, FEATURES, LOCATIONS, encode, level_gw

app = FastAPI(title="GridSense API")

app.add_middleware(
    CORSMiddleware,
    # any port on the local machine, so the Vite dev server works on 5173 or a fallback port
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    # deployed frontends: comma-separated origins, e.g. "https://gridsense.vercel.app"
    allow_origins=[o.strip() for o in os.environ.get("GRIDSENSE_ALLOWED_ORIGINS", "").split(",") if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Resolve paths from this file, so the server starts from any working directory
ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "models"
DATA_DIR = ROOT / "data" / "processed"

# load everything once at startup, not per-request
point_model = xgb.XGBRegressor()
point_model.load_model(MODELS_DIR / "point_model.json")
quantile_model = xgb.XGBRegressor()
quantile_model.load_model(MODELS_DIR / "quantile_model.json")
explainer = shap.TreeExplainer(point_model)
model_meta = json.loads((MODELS_DIR / "model_meta.json").read_text())
backtest_metrics = json.loads((MODELS_DIR / "backtest_metrics.json").read_text())
LEVELS = model_meta["levels"]
BAND_MARGINS = model_meta["band_margins"]

typical_stats = pd.read_parquet(DATA_DIR / "typical_stats.parquet")
merged = pd.read_parquet(DATA_DIR / "merged.parquet")

DATA_START = merged["datetime"].min().date()
DATA_END = merged["datetime"].max().date()

# Indexed lookups instead of scanning the full frames on every request
history = (
    merged.set_index(["location", "datetime"])[["temperature", "humidity", "demand_gw"]].sort_index()
)
stats_lookup = typical_stats.set_index(["location", "hour", "day_of_week"]).sort_index()

IN_HOLIDAYS = holidays.India()

CITIES = {
    'National':      (28.61, 77.21),  # Delhi
    'Northern':      (28.61, 77.21),  # Delhi
    'Western':       (19.08, 72.88),  # Mumbai
    'Eastern':       (22.57, 88.36),  # Kolkata
    'Southern':      (13.08, 80.27),  # Chennai
    'North-Eastern': (26.14, 91.74),  # Guwahati
}

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
# The forecast endpoint also serves roughly the last 3 months; older dates need the archive.
FORECAST_LOOKBACK_DAYS = 60
WEATHER_CACHE_TTL_SECONDS = 3600
_weather_cache: dict[tuple[str, date_type], tuple[float, list[tuple[float, float]]]] = {}

FEATURE_LABELS = {
    "temperature": "temperature",
    "humidity": "humidity",
    "hour": "time of day",
    "day_of_week": "day of the week",
    "month": "time of year",
    "is_holiday": "holiday status",
    "typical_ratio": "the usual pattern for this hour and weekday",
}
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


def check_location(location: str) -> None:
    if location not in LOCATIONS:
        raise HTTPException(status_code=400, detail=f"Unknown location: {location}")


def fetch_day_weather(location: str, day: date_type) -> list[tuple[float, float]]:
    """24 hourly (temperature, humidity) pairs from Open-Meteo, one request per day."""
    cached = _weather_cache.get((location, day))
    if cached and time.monotonic() - cached[0] < WEATHER_CACHE_TTL_SECONDS:
        return cached[1]

    lat, lon = CITIES[location]
    is_old = day < date_type.today() - timedelta(days=FORECAST_LOOKBACK_DAYS)
    try:
        response = requests.get(
            ARCHIVE_URL if is_old else FORECAST_URL,
            params={
                "latitude": lat,
                "longitude": lon,
                "hourly": "temperature_2m,relative_humidity_2m",
                "start_date": day.isoformat(),
                "end_date": day.isoformat(),
                "timezone": "auto",
            },
            timeout=10,
        )
    except requests.RequestException:
        raise HTTPException(status_code=502, detail="Weather service unreachable")

    if response.status_code == 400:
        # Open-Meteo rejects dates beyond its forecast horizon (about 16 days ahead)
        raise HTTPException(
            status_code=400,
            detail=f"No weather data available for {day.isoformat()}: "
                   "forecasts only reach about 16 days ahead",
        )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Weather service unavailable")

    hourly = response.json().get("hourly", {})
    temps = hourly.get("temperature_2m") or []
    hums = hourly.get("relative_humidity_2m") or []
    if len(temps) != 24 or len(hums) != 24 or None in temps or None in hums:
        raise HTTPException(
            status_code=404,
            detail=f"Weather data for {day.isoformat()} is incomplete",
        )

    weather = list(zip(temps, hums))
    _weather_cache[(location, day)] = (time.monotonic(), weather)
    return weather


def history_for_day(location: str, day: date_type) -> pd.DataFrame | None:
    """The dataset's 24 rows for a day, or None when the day is outside the dataset."""
    if not DATA_START <= day <= DATA_END:
        return None
    start = pd.Timestamp(day)
    rows = history.loc[(location, start):(location, start + pd.Timedelta(hours=23))]
    return rows if len(rows) == 24 else None


def day_weather(location: str, day: date_type) -> list[tuple[float, float]]:
    """Dataset weather when the day is inside the training data, Open-Meteo otherwise."""
    rows = history_for_day(location, day)
    if rows is not None:
        return list(zip(rows["temperature"].tolist(), rows["humidity"].tolist()))
    return fetch_day_weather(location, day)


def build_day_features(location: str, day: date_type) -> pd.DataFrame:
    """Feature rows for all 24 hours of a day."""
    check_location(location)
    weather = day_weather(location, day)
    day_of_week = day.weekday()  # 0=Monday
    is_holiday = int(day in IN_HOLIDAYS)
    midnight = datetime.combine(day, datetime.min.time())

    rows = []
    for hour in range(24):
        temperature, humidity = weather[hour]
        rows.append({
            "datetime": midnight.replace(hour=hour),
            "location": location,
            "temperature": temperature,
            "humidity": humidity,
            "hour": hour,
            "day_of_week": day_of_week,
            "month": day.month,
            "is_holiday": is_holiday,
            # typical demand-to-trend ratio for this location, hour and weekday
            "typical_ratio": float(stats_lookup.at[(location, hour, day_of_week), "mean"]),
        })
    return pd.DataFrame(rows)


def build_features(location: str, target_dt: datetime) -> pd.DataFrame:
    """Single feature row for the hour containing target_dt."""
    return build_day_features(location, target_dt.date()).iloc[[target_dt.hour]]


def predict(rows: pd.DataFrame) -> pd.DataFrame:
    """Point forecast and 80% band in GW, plus the unitless ratio the model outputs."""
    X = encode(rows)
    level = level_gw(rows["location"], rows["datetime"], LEVELS)
    ratio = point_model.predict(X)
    bounds = quantile_model.predict(X)
    margin = rows["location"].map(BAND_MARGINS).to_numpy()
    out = pd.DataFrame({
        "ratio": ratio,
        "level": level,
        "predicted": ratio * level,
        # the band always contains the point forecast
        "lower": np.minimum(bounds[:, 0] - margin, ratio) * level,
        "upper": np.maximum(bounds[:, 1] + margin, ratio) * level,
    })
    out["lower"] = out["lower"].clip(lower=0)
    return out


def anomaly_result(row: pd.Series, pred: pd.Series, threshold: float) -> dict:
    """Compare a forecast with what is typical for that location, hour and weekday.

    The comparison is made on demand relative to the growth trend, so later
    years are not flagged simply because demand has grown.
    """
    stats = stats_lookup.loc[(row["location"], row["hour"], row["day_of_week"])]
    mean, std = float(stats["mean"]), float(stats["std"])
    # a zero or missing spread means there is nothing to compare against
    z_score = (pred["ratio"] - mean) / std if std and std == std else 0.0
    return {
        "location": row["location"],
        "target_datetime": row["datetime"].isoformat(),
        "predicted_demand_gw": round(float(pred["predicted"]), 2),
        "typical_mean_gw": round(mean * float(pred["level"]), 2),
        "typical_std_gw": round(std * float(pred["level"]), 2),
        "z_score": round(float(z_score), 2),
        "is_anomaly": bool(abs(z_score) > threshold),
    }


def weather_source(day: date_type) -> str:
    if DATA_START <= day <= DATA_END:
        return "dataset"
    return "forecast" if day >= date_type.today() else "archive"


@app.get("/")
def root():
    return {"status": "GridSense API running"}


@app.get("/locations")
def get_locations():
    return {"locations": LOCATIONS}


class ForecastRequest(BaseModel):
    location: str
    target_datetime: datetime  # ISO format, e.g. "2024-06-15T14:00:00"


@app.post("/forecast")
def forecast(req: ForecastRequest):
    pred = predict(build_features(req.location, req.target_datetime)).iloc[0]
    return {
        "location": req.location,
        "target_datetime": req.target_datetime.isoformat(),
        "predicted_demand_gw": round(float(pred["predicted"]), 2),
        "lower_gw": round(float(pred["lower"]), 2),
        "upper_gw": round(float(pred["upper"]), 2),
    }


class DayForecastRequest(BaseModel):
    location: str
    date: date_type  # e.g. "2024-03-15"


@app.post("/forecast/day")
def forecast_day(req: DayForecastRequest):
    rows = build_day_features(req.location, req.date)
    preds = predict(rows)
    actuals = history_for_day(req.location, req.date)

    return {
        "location": req.location,
        "date": req.date.isoformat(),
        "band_coverage_pct": model_meta["band_coverage_pct"],
        "weather_source": weather_source(req.date),
        # true when the model was trained on this date, so the fit flatters the model
        "in_training_data": actuals is not None,
        "hourly_forecast": [
            {
                "hour": h,
                "predicted_demand_gw": round(float(preds.at[h, "predicted"]), 2),
                "lower_gw": round(float(preds.at[h, "lower"]), 2),
                "upper_gw": round(float(preds.at[h, "upper"]), 2),
                "actual_demand_gw": (
                    round(float(actuals["demand_gw"].iloc[h]), 2) if actuals is not None else None
                ),
                "temperature": round(float(rows.at[h, "temperature"]), 1),
            }
            for h in range(24)
        ],
    }


class WhatifRequest(BaseModel):
    location: str
    target_datetime: datetime
    changed_feature: str  # e.g. "temperature", "humidity", "is_holiday"
    delta: float           # e.g. +4 (add 4 degrees), -1 (subtract 1)


# feature -> (min, max) the modified value is clamped to; None means unbounded
VALID_WHATIF_FEATURES = {
    "temperature": (None, None),
    "humidity": (0, 100),
    "is_holiday": (0, 1),
}


@app.post("/whatif")
def whatif(req: WhatifRequest):
    if req.changed_feature not in VALID_WHATIF_FEATURES:
        raise HTTPException(
            status_code=400,
            detail=f"changed_feature must be one of {sorted(VALID_WHATIF_FEATURES)}"
        )

    original_row = build_features(req.location, req.target_datetime)
    modified_row = original_row.copy()
    low, high = VALID_WHATIF_FEATURES[req.changed_feature]
    modified_row[req.changed_feature] = (
        modified_row[req.changed_feature] + req.delta
    ).clip(lower=low, upper=high)

    preds = predict(pd.concat([original_row, modified_row], ignore_index=True))["predicted"]
    original_pred, new_pred = float(preds[0]), float(preds[1])

    return {
        "location": req.location,
        "target_datetime": req.target_datetime.isoformat(),
        "changed_feature": req.changed_feature,
        "delta": req.delta,
        "original_prediction_gw": round(original_pred, 2),
        "new_prediction_gw": round(new_pred, 2),
        "change_gw": round(new_pred - original_pred, 2),
    }


class ExplainRequest(BaseModel):
    location: str
    target_datetime: datetime
    top_n: int = Field(default=5, ge=1)


def shap_contributions(rows: pd.DataFrame) -> pd.DataFrame:
    """Signed SHAP values per row for the non-location features."""
    values = explainer.shap_values(encode(rows))
    return pd.DataFrame(values, columns=FEATURES)[BASE_FEATURES]


@app.post("/explain")
def explain(req: ExplainRequest):
    row = build_features(req.location, req.target_datetime)
    prediction = predict(row).iloc[0]["predicted"]

    contributions = shap_contributions(row).iloc[0].abs()
    total = contributions.sum()
    contributions_pct = (
        contributions / total * 100 if total else contributions
    ).sort_values(ascending=False)

    top_features = [
        {"feature": feat, "contribution_pct": round(float(pct), 2)}
        for feat, pct in contributions_pct.head(req.top_n).items()
    ]

    return {
        "location": req.location,
        "target_datetime": req.target_datetime.isoformat(),
        "predicted_demand_gw": round(float(prediction), 2),
        "top_features": top_features,
    }


@app.get("/anomaly")
def anomaly(location: str, target_datetime: datetime, threshold: float = 2.0):
    row = build_features(location, target_datetime)
    return anomaly_result(row.iloc[0], predict(row).iloc[0], threshold)


class DayAnomalyRequest(BaseModel):
    location: str
    date: date_type
    threshold: float = 2.0


@app.post("/anomaly/day")
def anomaly_day(req: DayAnomalyRequest):
    rows = build_day_features(req.location, req.date)
    preds = predict(rows)

    return {
        "location": req.location,
        "date": req.date.isoformat(),
        "hourly_anomalies": [
            anomaly_result(rows.iloc[h], preds.iloc[h], req.threshold) for h in range(24)
        ],
    }


def describe_difference(pct: float) -> str:
    if abs(pct) < 2:
        return "in line with"
    return f"{abs(pct):.0f}% {'above' if pct > 0 else 'below'}"


@app.post("/summary/day")
def summary_day(req: DayAnomalyRequest):
    """A plain-language briefing for one day, written from the model's own outputs."""
    rows = build_day_features(req.location, req.date)
    preds = predict(rows)
    weekday = WEEKDAYS[req.date.weekday()]
    region = "National" if req.location == "National" else f"{req.location} region"
    day_label = f"{weekday} {req.date.day} {req.date.strftime('%B %Y')}"

    peak = int(preds["predicted"].idxmax())
    low = int(preds["predicted"].idxmin())
    headline = (
        f"{region} demand on {day_label} is forecast to peak at "
        f"{preds.at[peak, 'predicted']:.1f} GW around {peak:02d}:00, "
        f"with an {model_meta['band_coverage_pct']:.0f}% range of "
        f"{preds.at[peak, 'lower']:.1f} to {preds.at[peak, 'upper']:.1f} GW."
    )

    points = [
        f"Demand is lowest around {low:02d}:00 at {preds.at[low, 'predicted']:.1f} GW, "
        f"a swing of {preds.at[peak, 'predicted'] - preds.at[low, 'predicted']:.1f} GW across the day."
    ]

    # Compare with the usual shape for this weekday, on trend-adjusted demand
    vs_typical = (preds["ratio"].mean() / rows["typical_ratio"].mean() - 1) * 100
    points.append(
        f"Across the day, demand is {describe_difference(vs_typical)} what is typical "
        f"for a {weekday} here, after allowing for year-on-year growth."
    )

    # What moves the peak hour away from its usual level: the largest signed
    # SHAP value among the day-specific features (not the fixed hour/weekday pattern)
    drivers = shap_contributions(rows.iloc[[peak]]).iloc[0][
        ["temperature", "humidity", "month", "is_holiday"]
    ]
    driver = drivers.abs().idxmax()
    effect_pct = float(drivers[driver] / preds.at[peak, "ratio"] * 100)
    if abs(effect_pct) >= 1:
        detail = {
            "temperature": f" ({rows.at[peak, 'temperature']:.0f}°C)",
            "humidity": f" ({rows.at[peak, 'humidity']:.0f}%)",
        }.get(driver, "")
        points.append(
            f"At the peak, {FEATURE_LABELS[driver]}{detail} has the largest effect, "
            f"{'raising' if effect_pct > 0 else 'lowering'} demand by about {abs(effect_pct):.0f}%."
        )

    holiday_name = IN_HOLIDAYS.get(req.date)
    if holiday_name:
        points.append(f"It is a public holiday ({holiday_name}), which the model accounts for.")

    anomalies = [
        h for h in range(24)
        if anomaly_result(rows.iloc[h], preds.iloc[h], req.threshold)["is_anomaly"]
    ]
    if anomalies:
        hours = ", ".join(f"{h:02d}:00" for h in anomalies[:6]) + (" and others" if len(anomalies) > 6 else "")
        points.append(
            f"{len(anomalies)} hour{'s are' if len(anomalies) > 1 else ' is'} flagged as unusual "
            f"for this weekday ({hours})."
        )
    else:
        points.append("No hours are flagged as unusual.")

    actuals = history_for_day(req.location, req.date)
    if actuals is not None:
        actual = actuals["demand_gw"].to_numpy()
        error_pct = np.abs(actual - preds["predicted"].to_numpy()).sum() / actual.sum() * 100
        points.append(
            f"Actual demand peaked at {actual.max():.1f} GW around {int(actual.argmax()):02d}:00. "
            f"The forecast was off by {error_pct:.1f}% across the day, but this date is in the "
            "training data, so see the accuracy panel for held-out performance."
        )
    else:
        years_ahead = (req.date - DATA_END).days / 365.25
        source = "a live weather forecast" if weather_source(req.date) == "forecast" else "recorded weather"
        points.append(
            f"This date is {years_ahead:.1f} years past the end of the training data. "
            f"The forecast uses {source} and an extrapolated growth trend, so treat it as indicative."
        )

    return {
        "location": req.location,
        "date": req.date.isoformat(),
        "headline": headline,
        "points": points,
    }


@app.get("/metrics")
def metrics():
    """Backtest results: how the model compares with baselines on held-out data."""
    return {k: v for k, v in backtest_metrics.items() if k != "daily_series"}


@app.get("/metrics/series")
def metrics_series(location: str):
    """Held-out daily mean demand, actual vs predicted, for one location."""
    check_location(location)
    return {"location": location, "series": backtest_metrics["daily_series"][location]}
