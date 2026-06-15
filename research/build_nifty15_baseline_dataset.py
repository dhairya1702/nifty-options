from __future__ import annotations

from pathlib import Path

import pandas as pd


DATASET_ROOT = Path.home() / ".cache" / "kagglehub" / "datasets" / "debashis74017" / "nifty-50-minute-data" / "versions" / "18"
INPUT_FILE = DATASET_ROOT / "NIFTY 50_15minute.csv"
VIX_FILE = DATASET_ROOT / "INDIA VIX_15minute.csv"
OUTPUT_DIR = Path(__file__).resolve().parent / "data"
OUTPUT_FILE = OUTPUT_DIR / "nifty50_15m_baseline.csv"


def safe_ratio(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    return numerator.div(denominator.where(denominator != 0))


def load_price_file(path: Path, prefix: str | None = None) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["date"] = pd.to_datetime(df["date"], errors="raise")
    df = df.sort_values("date").drop_duplicates(subset=["date"]).reset_index(drop=True)
    if prefix:
        rename_map = {column: f"{prefix}{column}" for column in ["open", "high", "low", "close", "volume"]}
        df = df.rename(columns=rename_map)
    return df


def build_dataset(input_file: Path = INPUT_FILE) -> pd.DataFrame:
    df = load_price_file(input_file)
    vix = load_price_file(VIX_FILE, prefix="vix_")
    df = df.merge(vix, on="date", how="left")
    df["trading_day"] = df["date"].dt.date

    df["candle_return"] = safe_ratio(df["close"] - df["open"], df["open"])
    df["hl_range"] = safe_ratio(df["high"] - df["low"], df["open"])
    df["close_to_high"] = safe_ratio(df["high"] - df["close"], df["open"])
    df["close_to_low"] = safe_ratio(df["close"] - df["low"], df["open"])

    df["return_1"] = df["close"].pct_change(1, fill_method=None)
    df["return_2"] = df["close"].pct_change(2, fill_method=None)
    df["return_4"] = df["close"].pct_change(4, fill_method=None)
    df["return_8"] = df["close"].pct_change(8, fill_method=None)

    df["rolling_mean_4"] = df["close"].rolling(4).mean()
    df["rolling_mean_8"] = df["close"].rolling(8).mean()
    df["rolling_mean_16"] = df["close"].rolling(16).mean()
    df["rolling_std_4"] = df["close"].pct_change(fill_method=None).rolling(4).std()
    df["rolling_std_8"] = df["close"].pct_change(fill_method=None).rolling(8).std()
    df["rolling_std_16"] = df["close"].pct_change(fill_method=None).rolling(16).std()

    df["dist_mean_4"] = safe_ratio(df["close"] - df["rolling_mean_4"], df["rolling_mean_4"])
    df["dist_mean_8"] = safe_ratio(df["close"] - df["rolling_mean_8"], df["rolling_mean_8"])
    df["dist_mean_16"] = safe_ratio(df["close"] - df["rolling_mean_16"], df["rolling_mean_16"])

    df["vix_return_1"] = df["vix_close"].pct_change(1, fill_method=None)
    df["vix_return_4"] = df["vix_close"].pct_change(4, fill_method=None)
    df["vix_hl_range"] = safe_ratio(df["vix_high"] - df["vix_low"], df["vix_open"])
    df["vix_rolling_mean_4"] = df["vix_close"].rolling(4).mean()
    df["vix_rolling_mean_8"] = df["vix_close"].rolling(8).mean()
    df["vix_rolling_std_4"] = df["vix_close"].pct_change(fill_method=None).rolling(4).std()
    df["vix_rolling_std_8"] = df["vix_close"].pct_change(fill_method=None).rolling(8).std()
    df["vix_dist_mean_4"] = safe_ratio(df["vix_close"] - df["vix_rolling_mean_4"], df["vix_rolling_mean_4"])
    df["vix_dist_mean_8"] = safe_ratio(df["vix_close"] - df["vix_rolling_mean_8"], df["vix_rolling_mean_8"])
    df["vix_spread_vs_nifty_return"] = df["vix_return_1"] - df["return_1"]

    df["hour"] = df["date"].dt.hour
    df["minute"] = df["date"].dt.minute
    df["weekday"] = df["date"].dt.weekday
    df["minutes_from_open"] = (df["hour"] * 60 + df["minute"]) - (9 * 60 + 15)
    df["bar_index_in_day"] = df.groupby("trading_day").cumcount()

    daily_summary = (
        df.groupby("trading_day")
        .agg(
            day_open=("open", "first"),
            day_high=("high", "max"),
            day_low=("low", "min"),
            day_close=("close", "last"),
        )
        .shift(1)
        .rename(
            columns={
                "day_open": "prev_day_open",
                "day_high": "prev_day_high",
                "day_low": "prev_day_low",
                "day_close": "prev_day_close",
            }
        )
    )
    daily_summary["prev_day_range"] = daily_summary["prev_day_high"] - daily_summary["prev_day_low"]
    df = df.merge(daily_summary, left_on="trading_day", right_index=True, how="left")

    df["session_open"] = df.groupby("trading_day")["open"].transform("first")
    df["gap_from_prev_close"] = safe_ratio(df["session_open"] - df["prev_day_close"], df["prev_day_close"])
    df["dist_prev_close"] = safe_ratio(df["close"] - df["prev_day_close"], df["prev_day_close"])
    df["dist_prev_high"] = safe_ratio(df["close"] - df["prev_day_high"], df["prev_day_high"])
    df["dist_prev_low"] = safe_ratio(df["close"] - df["prev_day_low"], df["prev_day_low"])
    df["prev_day_range_pct"] = safe_ratio(df["prev_day_range"], df["prev_day_close"])

    opening_range = (
        df[df["bar_index_in_day"] < 4]
        .groupby("trading_day")
        .agg(
            opening_range_high=("high", "max"),
            opening_range_low=("low", "min"),
        )
    )
    opening_range["opening_range_width"] = opening_range["opening_range_high"] - opening_range["opening_range_low"]
    df = df.merge(opening_range, left_on="trading_day", right_index=True, how="left")

    df["dist_opening_range_high"] = safe_ratio(df["close"] - df["opening_range_high"], df["opening_range_high"])
    df["dist_opening_range_low"] = safe_ratio(df["close"] - df["opening_range_low"], df["opening_range_low"])
    df["opening_range_width_pct"] = safe_ratio(df["opening_range_width"], df["session_open"])
    df["breakout_above_opening_range"] = (df["close"] > df["opening_range_high"]).astype("int64")
    df["breakdown_below_opening_range"] = (df["close"] < df["opening_range_low"]).astype("int64")

    df["day_high_so_far"] = df.groupby("trading_day")["high"].cummax()
    df["day_low_so_far"] = df.groupby("trading_day")["low"].cummin()
    df["day_range_so_far"] = df["day_high_so_far"] - df["day_low_so_far"]
    df["intraday_range_position"] = safe_ratio(df["close"] - df["day_low_so_far"], df["day_range_so_far"])
    df["dist_day_high_so_far"] = safe_ratio(df["close"] - df["day_high_so_far"], df["day_high_so_far"])
    df["dist_day_low_so_far"] = safe_ratio(df["close"] - df["day_low_so_far"], df["day_low_so_far"])

    df["next_close"] = df["close"].shift(-1)
    df["next_return_15m"] = safe_ratio(df["next_close"] - df["close"], df["close"])
    df["target_up_15m"] = (df["next_close"] > df["close"]).astype("Int64")

    df = df.drop(columns=["trading_day"])
    df = df.dropna().reset_index(drop=True)
    return df


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    dataset = build_dataset()
    dataset.to_csv(OUTPUT_FILE, index=False)

    print(f"Input:  {INPUT_FILE}")
    print(f"Output: {OUTPUT_FILE}")
    print(f"Rows:   {len(dataset):,}")
    print(f"Cols:   {len(dataset.columns)}")
    print("Columns:")
    print(", ".join(dataset.columns))
    print("\nTarget distribution:")
    print(dataset["target_up_15m"].value_counts(normalize=True).sort_index().to_string())


if __name__ == "__main__":
    main()
