from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path

import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score, precision_score, recall_score
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler


DATA_FILE = Path(__file__).resolve().parent / "data" / "nifty50_15m_baseline.csv"
OUTPUT_FILE = Path(__file__).resolve().parent / "data" / "nifty50_15m_baseline_metrics.json"


FEATURE_COLUMNS = [
    "candle_return",
    "hl_range",
    "close_to_high",
    "close_to_low",
    "return_1",
    "return_2",
    "return_4",
    "return_8",
    "rolling_std_4",
    "rolling_std_8",
    "rolling_std_16",
    "dist_mean_4",
    "dist_mean_8",
    "dist_mean_16",
    "vix_return_1",
    "vix_return_4",
    "vix_hl_range",
    "vix_rolling_std_4",
    "vix_rolling_std_8",
    "vix_dist_mean_4",
    "vix_dist_mean_8",
    "vix_spread_vs_nifty_return",
    "bar_index_in_day",
    "gap_from_prev_close",
    "dist_prev_close",
    "dist_prev_high",
    "dist_prev_low",
    "prev_day_range_pct",
    "dist_opening_range_high",
    "dist_opening_range_low",
    "opening_range_width_pct",
    "breakout_above_opening_range",
    "breakdown_below_opening_range",
    "intraday_range_position",
    "dist_day_high_so_far",
    "dist_day_low_so_far",
    "hour",
    "minute",
    "weekday",
    "minutes_from_open",
]


@dataclass
class Metrics:
    name: str
    accuracy: float
    precision_up: float
    recall_up: float
    f1_up: float
    support: int


def load_dataset() -> pd.DataFrame:
    df = pd.read_csv(DATA_FILE, parse_dates=["date"])
    df = df.sort_values("date").reset_index(drop=True)
    return df


def split_dataset(df: pd.DataFrame, train_ratio: float = 0.8) -> tuple[pd.DataFrame, pd.DataFrame]:
    cutoff = int(len(df) * train_ratio)
    train = df.iloc[:cutoff].copy()
    test = df.iloc[cutoff:].copy()
    return train, test


def evaluate_predictions(y_true: pd.Series, y_pred: pd.Series, name: str) -> Metrics:
    return Metrics(
        name=name,
        accuracy=float(accuracy_score(y_true, y_pred)),
        precision_up=float(precision_score(y_true, y_pred, zero_division=0)),
        recall_up=float(recall_score(y_true, y_pred, zero_division=0)),
        f1_up=float(f1_score(y_true, y_pred, zero_division=0)),
        support=len(y_true),
    )


def always_up_baseline(test: pd.DataFrame) -> pd.Series:
    return pd.Series(1, index=test.index, dtype="int64")


def momentum_baseline(test: pd.DataFrame) -> pd.Series:
    # Predict continuation from the latest 15m return sign.
    return (test["return_1"] > 0).astype("int64")


def intraday_bucket_baseline(train: pd.DataFrame, test: pd.DataFrame) -> pd.Series:
    grouped = train.groupby(["weekday", "hour", "minute"])["target_up_15m"].mean()
    global_rate = float(train["target_up_15m"].mean())

    scores = []
    for _, row in test.iterrows():
        rate = grouped.get((int(row["weekday"]), int(row["hour"]), int(row["minute"])), global_rate)
        scores.append(1 if rate >= 0.5 else 0)
    return pd.Series(scores, index=test.index, dtype="int64")


def feature_summary(train: pd.DataFrame) -> dict[str, float]:
    correlations = {}
    for column in FEATURE_COLUMNS:
        correlations[column] = float(train[column].corr(train["target_up_15m"]))
    return dict(sorted(correlations.items(), key=lambda item: abs(item[1]), reverse=True))


def train_sklearn_models(train: pd.DataFrame, test: pd.DataFrame) -> list[Metrics]:
    x_train = train[FEATURE_COLUMNS]
    y_train = train["target_up_15m"].astype("int64")
    x_test = test[FEATURE_COLUMNS]
    y_test = test["target_up_15m"].astype("int64")

    logistic = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("model", LogisticRegression(max_iter=2000, random_state=42)),
        ]
    )
    forest = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            (
                "model",
                RandomForestClassifier(
                    n_estimators=300,
                    max_depth=8,
                    min_samples_leaf=20,
                    random_state=42,
                    n_jobs=-1,
                ),
            ),
        ]
    )
    hist_gb = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            (
                "model",
                HistGradientBoostingClassifier(
                    max_depth=6,
                    learning_rate=0.05,
                    max_iter=250,
                    min_samples_leaf=50,
                    random_state=42,
                ),
            ),
        ]
    )

    models = [
        ("logistic_regression", logistic),
        ("random_forest", forest),
        ("hist_gradient_boosting", hist_gb),
    ]

    results: list[Metrics] = []
    for name, model in models:
        model.fit(x_train, y_train)
        predictions = pd.Series(model.predict(x_test), index=test.index)
        results.append(evaluate_predictions(y_test, predictions, name))

    return results


def main() -> None:
    df = load_dataset()
    train, test = split_dataset(df)

    y_test = test["target_up_15m"].astype("int64")

    metrics = [
        evaluate_predictions(y_test, always_up_baseline(test), "always_up"),
        evaluate_predictions(y_test, momentum_baseline(test), "momentum_continuation"),
        evaluate_predictions(y_test, intraday_bucket_baseline(train, test), "intraday_bucket"),
    ]
    metrics.extend(train_sklearn_models(train, test))

    summary = {
        "dataset_rows": len(df),
        "train_rows": len(train),
        "test_rows": len(test),
        "train_date_min": str(train["date"].min()),
        "train_date_max": str(train["date"].max()),
        "test_date_min": str(test["date"].min()),
        "test_date_max": str(test["date"].max()),
        "target_up_rate_train": float(train["target_up_15m"].mean()),
        "target_up_rate_test": float(test["target_up_15m"].mean()),
        "feature_target_correlations": feature_summary(train),
        "baselines": [asdict(item) for item in metrics],
    }

    OUTPUT_FILE.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
