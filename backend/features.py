"""Feature and trend logic shared by training (train.py) and serving (main.py).

The model does not predict demand in GW directly. Demand grows every year and
tree models cannot extrapolate a trend, so each region gets a fitted growth
curve (its "level") and the model predicts demand as a ratio to that level.
Keeping this logic in one module guarantees training and serving agree.
"""
import numpy as np
import pandas as pd

T0 = pd.Timestamp("2019-01-01")
PROFILE_KEY = ["location", "hour", "day_of_week"]
LOCATIONS = ["Eastern", "National", "North-Eastern", "Northern", "Southern", "Western"]
BASE_FEATURES = [
    "temperature", "humidity", "hour", "day_of_week", "month", "is_holiday", "typical_ratio",
]
LOCATION_FEATURES = [f"location_{loc}" for loc in LOCATIONS]
FEATURES = BASE_FEATURES + LOCATION_FEATURES


def years_since_start(datetimes) -> np.ndarray:
    delta = pd.to_datetime(pd.Series(datetimes).to_numpy()) - T0
    return np.asarray(delta.total_seconds()) / 86400 / 365.25


def fit_levels(train: pd.DataFrame) -> dict[str, list[float]]:
    """Log-linear growth trend per location, fitted on daily mean demand."""
    daily = (
        train.groupby(["location", train["datetime"].dt.floor("D")])["demand_gw"]
        .mean()
        .reset_index()
    )
    levels = {}
    for location, group in daily.groupby("location"):
        slope, intercept = np.polyfit(
            years_since_start(group["datetime"]), np.log(group["demand_gw"].to_numpy()), 1
        )
        levels[location] = [float(slope), float(intercept)]
    return levels


def level_gw(locations, datetimes, levels: dict[str, list[float]]) -> np.ndarray:
    """Trend demand in GW for each (location, datetime) pair."""
    locations = list(locations)
    slope = np.array([levels[loc][0] for loc in locations])
    intercept = np.array([levels[loc][1] for loc in locations])
    return np.exp(slope * years_since_start(datetimes) + intercept)


def fit_ratio_stats(train: pd.DataFrame) -> pd.DataFrame:
    """Typical demand-to-trend ratio (mean and std) per location, hour and weekday.

    `train` must already have a `ratio` column.
    """
    return train.groupby(PROFILE_KEY)["ratio"].agg(["mean", "std"]).reset_index()


def encode(rows: pd.DataFrame) -> pd.DataFrame:
    """Model input matrix. `rows` needs BASE_FEATURES plus a `location` column."""
    encoded = rows[BASE_FEATURES].astype(float).copy()
    for location in LOCATIONS:
        encoded[f"location_{location}"] = (rows["location"] == location).astype(float)
    return encoded[FEATURES]
