"""Backtest and train the GridSense demand models.

Run from anywhere:  python backend/train.py

1. Rolling-origin backtest: four consecutive six-month test windows, each
   predicted by models trained only on the data before that window.
2. Calibrates the 80% prediction band on the backtest errors (conformalized
   quantile regression).
3. Retrains on all data and writes the artifacts the API loads.
"""
import json
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb

from features import (
    LOCATIONS, PROFILE_KEY, encode, fit_levels, fit_ratio_stats, level_gw,
)

ROOT = Path(__file__).resolve().parent.parent
MODELS_DIR = ROOT / "models"
DATA_DIR = ROOT / "data" / "processed"

FOLDS = [
    ("2022-05-01", "2022-11-01"),
    ("2022-11-01", "2023-05-01"),
    ("2023-05-01", "2023-11-01"),
    ("2023-11-01", "2024-05-01"),
]
QUANTILES = [0.1, 0.9]
BAND_COVERAGE = 0.8
XGB_PARAMS = dict(n_estimators=300, max_depth=6, learning_rate=0.05, random_state=42)


def load_data() -> pd.DataFrame:
    df = pd.read_parquet(DATA_DIR / "merged.parquet")
    df = df[["datetime", "location", "demand_gw", "temperature", "humidity", "is_holiday"]]
    df = df.sort_values(["datetime", "location"]).reset_index(drop=True)
    df["hour"] = df["datetime"].dt.hour
    df["day_of_week"] = df["datetime"].dt.dayofweek
    df["month"] = df["datetime"].dt.month
    return df


def fit_models(train: pd.DataFrame) -> dict:
    """Fit trend, typical profile, point model and quantile model on `train`."""
    train = train.copy()
    levels = fit_levels(train)
    train["ratio"] = train["demand_gw"] / level_gw(train["location"], train["datetime"], levels)
    ratio_stats = fit_ratio_stats(train)
    train = add_typical_ratio(train, ratio_stats)
    X, y = encode(train), train["ratio"]
    point = xgb.XGBRegressor(**XGB_PARAMS).fit(X, y)
    quantile = xgb.XGBRegressor(
        objective="reg:quantileerror", quantile_alpha=QUANTILES, **XGB_PARAMS
    ).fit(X, y)
    return {"levels": levels, "ratio_stats": ratio_stats, "point": point, "quantile": quantile}


def add_typical_ratio(df: pd.DataFrame, ratio_stats: pd.DataFrame) -> pd.DataFrame:
    typical = ratio_stats.rename(columns={"mean": "typical_ratio"})[PROFILE_KEY + ["typical_ratio"]]
    return df.merge(typical, on=PROFILE_KEY, how="left")


def predict(models: dict, df: pd.DataFrame) -> pd.DataFrame:
    """Out-of-sample predictions for `df`, in ratio units and in GW."""
    df = add_typical_ratio(df, models["ratio_stats"])
    X = encode(df)
    level = level_gw(df["location"], df["datetime"], models["levels"])
    bounds = models["quantile"].predict(X)
    out = df[["datetime", "location", "demand_gw"]].copy()
    out["level"] = level
    out["ratio"] = out["demand_gw"] / level
    out["pred_ratio"] = models["point"].predict(X)
    out["lo_ratio"] = bounds[:, 0]
    out["hi_ratio"] = bounds[:, 1]
    out["predicted"] = out["pred_ratio"] * level
    return out


def baseline_predictions(train: pd.DataFrame, test: pd.DataFrame, full: pd.DataFrame) -> pd.DataFrame:
    """Reference forecasts the model has to beat."""
    out = test[["datetime", "location"]].copy()

    # Typical demand for this region, hour and weekday, with no trend
    profile = train.groupby(PROFILE_KEY)["demand_gw"].mean().rename("profile").reset_index()
    with_profile = test.merge(profile, on=PROFILE_KEY, how="left")
    out["Typical profile"] = with_profile["profile"].to_numpy()

    # Actual demand at the same hour one week earlier (needs last week's actuals)
    last_week = full[["datetime", "location", "demand_gw"]].copy()
    last_week["datetime"] += pd.Timedelta(days=7)
    out["Same hour last week"] = test.merge(
        last_week.rename(columns={"demand_gw": "lag"}), on=["datetime", "location"], how="left"
    )["lag"].to_numpy()

    # The project's first model: XGBoost on raw GW with year and the typical profile as features
    def original_X(df):
        X = df[["temperature", "humidity", "hour", "day_of_week", "month", "is_holiday"]].astype(float).copy()
        X["historical_avg_load"] = df["profile"].to_numpy()
        X["year"] = df["datetime"].dt.year.to_numpy()
        for location in LOCATIONS:
            X[f"location_{location}"] = (df["location"] == location).to_numpy().astype(float)
        return X

    train_with_profile = train.merge(profile, on=PROFILE_KEY, how="left")
    original = xgb.XGBRegressor(**XGB_PARAMS).fit(
        original_X(train_with_profile), train_with_profile["demand_gw"]
    )
    out["Original XGBoost"] = original.predict(original_X(with_profile))
    return out


def error_metrics(actual: pd.Series, predicted: pd.Series, location: pd.Series) -> dict:
    """MAE in GW, and WAPE (total absolute error / total demand) averaged over regions.

    WAPE is used because regions differ 100x in size: pooled MAE is dominated
    by the national series, and MAPE over-weights low-demand hours.
    """
    error = (actual - predicted).abs()
    by_location = error.groupby(location).sum() / actual.groupby(location).sum() * 100
    return {
        "mae_gw": round(float(error.mean()), 2),
        "wape_pct": round(float(by_location.mean()), 2),
        "wape_by_location": {loc: round(float(v), 2) for loc, v in by_location.items()},
    }


def conformal_margins(frame: pd.DataFrame) -> dict[str, float]:
    """Per-location margin that widens the raw quantile band to BAND_COVERAGE."""
    score = np.maximum(frame["lo_ratio"] - frame["ratio"], frame["ratio"] - frame["hi_ratio"])
    return {
        loc: float(np.quantile(score[frame["location"] == loc], BAND_COVERAGE))
        for loc in LOCATIONS
    }


def coverage(frame: pd.DataFrame, margins: dict[str, float] | None = None) -> float:
    margin = frame["location"].map(margins).to_numpy() if margins else 0.0
    inside = (frame["ratio"] >= frame["lo_ratio"] - margin) & (frame["ratio"] <= frame["hi_ratio"] + margin)
    return round(float(inside.mean() * 100), 1)


def backtest(df: pd.DataFrame) -> tuple[dict, pd.DataFrame]:
    fold_frames, fold_reports = [], []
    for i, (start, end) in enumerate(FOLDS):
        train = df[df["datetime"] < start]
        test = df[(df["datetime"] >= start) & (df["datetime"] < end)]
        frame = predict(fit_models(train), test)
        frame["fold"] = i
        baselines = baseline_predictions(train, test, df)
        for name in baselines.columns[2:]:
            frame[name] = baselines[name].to_numpy()
        fold_frames.append(frame)

        report = {"test_start": start, "test_end": str((pd.Timestamp(end) - pd.Timedelta(days=1)).date())}
        report["models"] = {
            name: error_metrics(frame["demand_gw"], frame[column], frame["location"])
            for name, column in MODEL_COLUMNS.items()
        }
        fold_reports.append(report)
        print(f"fold {i + 1}: {start} to {report['test_end']}  "
              + "  ".join(f"{n} {m['wape_pct']}%" for n, m in report["models"].items()))

    oos = pd.concat(fold_frames, ignore_index=True)

    summary = {}
    for name in MODEL_COLUMNS:
        folds = [r["models"][name] for r in fold_reports]
        summary[name] = {
            "mae_gw": round(float(np.mean([f["mae_gw"] for f in folds])), 2),
            "wape_pct": round(float(np.mean([f["wape_pct"] for f in folds])), 2),
            "wape_by_location": {
                loc: round(float(np.mean([f["wape_by_location"][loc] for f in folds])), 2)
                for loc in LOCATIONS
            },
        }

    # Band calibration is checked honestly: margins from the first three folds, coverage on the last
    last = len(FOLDS) - 1
    held_out_margins = conformal_margins(oos[oos["fold"] < last])
    band = {
        "target_coverage_pct": BAND_COVERAGE * 100,
        "raw_coverage_pct": coverage(oos),
        "calibrated_coverage_pct": coverage(oos[oos["fold"] == last], held_out_margins),
        "calibrated_coverage_note": "margins fitted on folds 1-3, coverage measured on fold 4",
    }

    # Daily means of held-out actual vs predicted, for the dashboard's accuracy chart
    daily = (
        oos.assign(date=oos["datetime"].dt.strftime("%Y-%m-%d"))
        .groupby(["location", "date"])[["demand_gw", "predicted"]]
        .mean()
        .round(2)
        .reset_index()
    )
    daily_series = {
        loc: [
            {"date": r.date, "actual_gw": r.demand_gw, "predicted_gw": r.predicted}
            for r in daily[daily["location"] == loc].itertuples()
        ]
        for loc in LOCATIONS
    }

    metrics = {
        "trained_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "data_start": str(df["datetime"].min().date()),
        "data_end": str(df["datetime"].max().date()),
        "method": "Rolling-origin backtest: each six-month window is predicted by models "
                  "trained only on earlier data.",
        "summary": summary,
        "folds": fold_reports,
        "band": band,
        "daily_series": daily_series,
    }
    return metrics, oos


MODEL_COLUMNS = {
    "GridSense": "predicted",
    "Original XGBoost": "Original XGBoost",
    "Same hour last week": "Same hour last week",
    "Typical profile": "Typical profile",
}


def main() -> None:
    df = load_data()
    metrics, oos = backtest(df)

    final = fit_models(df)
    margins = conformal_margins(oos)

    MODELS_DIR.mkdir(exist_ok=True)
    final["point"].save_model(MODELS_DIR / "point_model.json")
    final["quantile"].save_model(MODELS_DIR / "quantile_model.json")
    final["ratio_stats"].to_parquet(DATA_DIR / "typical_stats.parquet", index=False)
    (MODELS_DIR / "model_meta.json").write_text(json.dumps({
        "levels": final["levels"],
        "band_margins": margins,
        "quantiles": QUANTILES,
        "band_coverage_pct": BAND_COVERAGE * 100,
    }, indent=2))
    (MODELS_DIR / "backtest_metrics.json").write_text(json.dumps(metrics))

    print("\nmean over folds:")
    for name, m in metrics["summary"].items():
        print(f"  {name:22s} WAPE {m['wape_pct']:5.2f}%   MAE {m['mae_gw']:5.2f} GW")
    print("band:", metrics["band"])
    print("annual growth:", {loc: f"{(np.exp(v[0]) - 1) * 100:.1f}%" for loc, v in final["levels"].items()})


if __name__ == "__main__":
    main()
