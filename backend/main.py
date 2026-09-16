from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from datetime import datetime
import joblib
import pandas as pd
import holidays
import requests

app = FastAPI()

# load everything once at startup, not per-request
xgb_model = joblib.load('../models/xgb_demand_model.joblib')
explainer = joblib.load('../models/shap_explainer.joblib')
feature_cols = joblib.load('../models/feature_cols.joblib')
non_location_features = joblib.load('../models/non_location_features.joblib')
typical_stats = pd.read_parquet('../data/processed/typical_stats.parquet')
merged = pd.read_parquet('../data/processed/merged.parquet')

IN_HOLIDAYS = holidays.India()

CITIES = {
    'National':      (28.61, 77.21),  # Delhi
    'Northern':      (28.61, 77.21),  # Delhi
    'Western':       (19.08, 72.88),  # Mumbai
    'Eastern':       (22.57, 88.36),  # Kolkata
    'Southern':      (13.08, 80.27),  # Chennai
    'North-Eastern': (26.14, 91.74),  # Guwahati
}


@app.get("/")
def root():
    return {"status": "GridSense API running"}


@app.get("/locations")
def get_locations():
    return {"locations": sorted(merged['location'].unique().tolist())}


class ForecastRequest(BaseModel):
    location: str
    target_datetime: datetime  # ISO format, e.g. "2024-06-15T14:00:00"


def fetch_live_weather(location: str, target_dt: datetime) -> tuple[float, float]:
    lat, lon = CITIES[location]
    date_str = target_dt.date().isoformat()
    response = requests.get(
        "https://api.open-meteo.com/v1/forecast",
        params={
            "latitude": lat,
            "longitude": lon,
            "hourly": "temperature_2m,relative_humidity_2m",
            "start_date": date_str,
            "end_date": date_str,
            "timezone": "auto",
        },
        timeout=10,
    )
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail="Weather forecast service unavailable")

    data = response.json()
    hourly_times = data["hourly"]["time"]
    target_iso = target_dt.strftime("%Y-%m-%dT%H:00")

    if target_iso not in hourly_times:
        raise HTTPException(status_code=400, detail="Requested datetime is outside Open-Meteo's forecast range")

    idx = hourly_times.index(target_iso)
    temperature = data["hourly"]["temperature_2m"][idx]
    humidity = data["hourly"]["relative_humidity_2m"][idx]
    return temperature, humidity


def build_features(location: str, target_dt: datetime) -> dict:
    if location not in merged['location'].unique():
        raise HTTPException(status_code=400, detail=f"Unknown location: {location}")

    hour = target_dt.hour
    day_of_week = target_dt.weekday()  # 0=Monday
    month = target_dt.month
    is_holiday = int(target_dt.date() in IN_HOLIDAYS)

    # historical_avg_load: always from typical_stats, keyed by location/hour/day_of_week
    stats_row = typical_stats[
        (typical_stats['location'] == location) &
        (typical_stats['hour'] == hour) &
        (typical_stats['day_of_week'] == day_of_week)
    ]
    if stats_row.empty:
        raise HTTPException(status_code=404, detail="No historical stats for this location/hour/day_of_week combo")
    historical_avg_load = stats_row['mean'].values[0]

    # temperature/humidity: historical if date is in range, else live Open-Meteo forecast
    is_future = target_dt.date() > merged['datetime'].max().date()
    if is_future:
        temperature, humidity = fetch_live_weather(location, target_dt)
    else:
        weather_row = merged[
            (merged['location'] == location) &
            (merged['datetime'] == target_dt)
        ]
        if weather_row.empty:
            raise HTTPException(status_code=404, detail="No historical weather data for this exact datetime")
        temperature = weather_row['temperature'].values[0]
        humidity = weather_row['humidity'].values[0]

    return {
        "temperature": temperature,
        "humidity": humidity,
        "hour": hour,
        "day_of_week": day_of_week,
        "month": month,
        "is_holiday": is_holiday,
        "historical_avg_load": historical_avg_load,
        "location": location,
        "year": target_dt.year,
    }


@app.post("/forecast")
def forecast(req: ForecastRequest):
    features = build_features(req.location, req.target_datetime)
    row = pd.DataFrame([features])
    row_encoded = pd.get_dummies(row).reindex(columns=feature_cols, fill_value=0)
    prediction = xgb_model.predict(row_encoded)[0]
    return {
        "location": req.location,
        "target_datetime": req.target_datetime.isoformat(),
        "predicted_demand_gw": round(float(prediction), 2)
    }


class WhatifRequest(BaseModel):
    location: str
    target_datetime: datetime
    changed_feature: str  # e.g. "temperature", "humidity", "is_holiday"
    delta: float           # e.g. +4 (add 4 degrees), -1 (subtract 1)


VALID_WHATIF_FEATURES = {"temperature", "humidity", "is_holiday"}  # adjust to match your API_CONTRACT enum


@app.post("/whatif")
def whatif(req: WhatifRequest):
    if req.changed_feature not in VALID_WHATIF_FEATURES:
        raise HTTPException(
            status_code=400,
            detail=f"changed_feature must be one of {sorted(VALID_WHATIF_FEATURES)}"
        )

    features = build_features(req.location, req.target_datetime)
    original_row = pd.DataFrame([features])
    original_encoded = pd.get_dummies(original_row).reindex(columns=feature_cols, fill_value=0)

    modified_row = original_row.copy()
    modified_row[req.changed_feature] = modified_row[req.changed_feature] + req.delta
    modified_encoded = pd.get_dummies(modified_row).reindex(columns=feature_cols, fill_value=0)

    original_pred = xgb_model.predict(original_encoded)[0]
    new_pred = xgb_model.predict(modified_encoded)[0]

    return {
        "location": req.location,
        "target_datetime": req.target_datetime.isoformat(),
        "changed_feature": req.changed_feature,
        "delta": req.delta,
        "original_prediction_gw": round(float(original_pred), 2),
        "new_prediction_gw": round(float(new_pred), 2),
        "change_gw": round(float(new_pred - original_pred), 2),
    }


class ExplainRequest(BaseModel):
    location: str
    target_datetime: datetime
    top_n: int = 5


@app.post("/explain")
def explain(req: ExplainRequest):
    features = build_features(req.location, req.target_datetime)
    row = pd.DataFrame([features])
    row_encoded = pd.get_dummies(row).reindex(columns=feature_cols, fill_value=0)

    prediction = xgb_model.predict(row_encoded)[0]
    shap_vals = explainer.shap_values(row_encoded)[0]

    contributions = pd.Series(shap_vals, index=feature_cols)[non_location_features].abs()
    contributions_pct = (contributions / contributions.sum() * 100).sort_values(ascending=False)

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
    features = build_features(location, target_datetime)
    row = pd.DataFrame([features])
    row_encoded = pd.get_dummies(row).reindex(columns=feature_cols, fill_value=0)
    predicted = xgb_model.predict(row_encoded)[0]

    stats_row = typical_stats[
        (typical_stats['location'] == location) &
        (typical_stats['hour'] == features['hour']) &
        (typical_stats['day_of_week'] == features['day_of_week'])
    ]
    if stats_row.empty:
        raise HTTPException(status_code=404, detail="No historical stats for this location/hour/day_of_week combo")

    mean = stats_row['mean'].values[0]
    std = stats_row['std'].values[0]
    z_score = (predicted - mean) / std
    is_anomaly = abs(z_score) > threshold

    return {
        "location": location,
        "target_datetime": target_datetime.isoformat(),
        "predicted_demand_gw": round(float(predicted), 2),
        "typical_mean_gw": round(float(mean), 2),
        "typical_std_gw": round(float(std), 2),
        "z_score": round(float(z_score), 2),
        "is_anomaly": bool(is_anomaly),
    }