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
OUTPUT_FILE = Path(__file__).resolve().parent / "data" / "nifty50_15m_move_bucket_metrics.json"

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

CLASS_NAMES = {-1: "down", 0: "flat", 1: "up"}


@dataclass
class MultiClassMetrics:
    name: str
    accuracy: float
    macro_f1: float
    precision_down: float
    recall_down: float
    precision_flat: float
    recall_flat: float
    precision_up: float
    recall_up: float
    support: int


def load_dataset() -> pd.DataFrame:
    df = pd.read_csv(DATA_FILE, parse_dates=["date"])
    df = df.sort_values("date").reset_index(drop=True)
    return df


def split_dataset(df: pd.DataFrame, train_ratio: float = 0.8) -> tuple[pd.DataFrame, pd.DataFrame]:
    cutoff = int(len(df) * train_ratio)
    return df.iloc[:cutoff].copy(), df.iloc[cutoff:].copy()


def build_move_bucket_labels(train: pd.DataFrame, test: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame, float]:
    threshold = float(train["next_return_15m"].abs().quantile(1 / 3))

    def bucketize(series: pd.Series) -> pd.Series:
        labels = pd.Series(0, index=series.index, dtype="int64")
        labels.loc[series <= -threshold] = -1
        labels.loc[series >= threshold] = 1
        return labels

    train = train.copy()
    test = test.copy()
    train["target_bucket_15m"] = bucketize(train["next_return_15m"])
    test["target_bucket_15m"] = bucketize(test["next_return_15m"])
    return train, test, threshold


def evaluate_predictions(y_true: pd.Series, y_pred: pd.Series, name: str) -> MultiClassMetrics:
    labels = [-1, 0, 1]
    precision = precision_score(y_true, y_pred, labels=labels, average=None, zero_division=0)
    recall = recall_score(y_true, y_pred, labels=labels, average=None, zero_division=0)

    return MultiClassMetrics(
        name=name,
        accuracy=float(accuracy_score(y_true, y_pred)),
        macro_f1=float(f1_score(y_true, y_pred, labels=labels, average="macro", zero_division=0)),
        precision_down=float(precision[0]),
        recall_down=float(recall[0]),
        precision_flat=float(precision[1]),
        recall_flat=float(recall[1]),
        precision_up=float(precision[2]),
        recall_up=float(recall[2]),
        support=len(y_true),
    )


def flat_baseline(test: pd.DataFrame) -> pd.Series:
    return pd.Series(0, index=test.index, dtype="int64")


def momentum_bucket_baseline(test: pd.DataFrame, threshold: float) -> pd.Series:
    labels = pd.Series(0, index=test.index, dtype="int64")
    labels.loc[test["return_1"] <= -threshold] = -1
    labels.loc[test["return_1"] >= threshold] = 1
    return labels


def intraday_bucket_baseline(train: pd.DataFrame, test: pd.DataFrame) -> pd.Series:
    grouped = train.groupby(["weekday", "hour", "minute"])["target_bucket_15m"]

    def most_common(values: pd.Series) -> int:
        counts = values.value_counts()
        return int(counts.index[0])

    lookup = grouped.apply(most_common)
    global_mode = int(train["target_bucket_15m"].mode().iloc[0])

    predictions = []
    for _, row in test.iterrows():
        predictions.append(lookup.get((int(row["weekday"]), int(row["hour"]), int(row["minute"])), global_mode))
    return pd.Series(predictions, index=test.index, dtype="int64")


def train_models(train: pd.DataFrame, test: pd.DataFrame) -> list[MultiClassMetrics]:
    x_train = train[FEATURE_COLUMNS]
    y_train = train["target_bucket_15m"].astype("int64")
    x_test = test[FEATURE_COLUMNS]
    y_test = test["target_bucket_15m"].astype("int64")

    logistic = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            ("scaler", StandardScaler()),
            ("model", LogisticRegression(max_iter=3000, random_state=42)),
        ]
    )
    forest = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
            (
                "model",
                RandomForestClassifier(
                    n_estimators=300,
                    max_depth=10,
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
                    max_iter=300,
                    min_samples_leaf=50,
                    random_state=42,
                ),
            ),
        ]
    )

    results: list[MultiClassMetrics] = []
    for name, model in [
        ("logistic_regression", logistic),
        ("random_forest", forest),
        ("hist_gradient_boosting", hist_gb),
    ]:
        model.fit(x_train, y_train)
        predictions = pd.Series(model.predict(x_test), index=test.index)
        results.append(evaluate_predictions(y_test, predictions, name))

    return results


def main() -> None:
    df = load_dataset()
    train, test = split_dataset(df)
    train, test, threshold = build_move_bucket_labels(train, test)

    y_test = test["target_bucket_15m"].astype("int64")

    metrics = [
        evaluate_predictions(y_test, flat_baseline(test), "always_flat"),
        evaluate_predictions(y_test, momentum_bucket_baseline(test, threshold), "momentum_bucket"),
        evaluate_predictions(y_test, intraday_bucket_baseline(train, test), "intraday_bucket"),
    ]
    metrics.extend(train_models(train, test))

    summary = {
        "dataset_rows": len(df),
        "train_rows": len(train),
        "test_rows": len(test),
        "train_date_min": str(train["date"].min()),
        "train_date_max": str(train["date"].max()),
        "test_date_min": str(test["date"].min()),
        "test_date_max": str(test["date"].max()),
        "flat_threshold_abs_return": threshold,
        "bucket_labels": CLASS_NAMES,
        "train_bucket_distribution": train["target_bucket_15m"].value_counts(normalize=True).sort_index().to_dict(),
        "test_bucket_distribution": test["target_bucket_15m"].value_counts(normalize=True).sort_index().to_dict(),
        "models": [asdict(metric) for metric in metrics],
    }

    OUTPUT_FILE.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
