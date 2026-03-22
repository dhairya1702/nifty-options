alter table if exists option_snapshots
  add column if not exists underlying text,
  add column if not exists expiry date,
  add column if not exists tradingsymbol text,
  add column if not exists instrument_token bigint;

alter table if exists pcr_timeseries
  add column if not exists underlying text,
  add column if not exists expiry date;

create index if not exists option_snapshots_timestamp_idx
  on option_snapshots (underlying, timestamp desc);

create index if not exists option_snapshots_strike_idx
  on option_snapshots (underlying, strike_price, option_type, timestamp desc);

create unique index if not exists option_snapshots_identity_idx
  on option_snapshots (underlying, timestamp, expiry, strike_price, option_type);

create index if not exists pcr_timeseries_timestamp_idx
  on pcr_timeseries (underlying, timestamp desc);

create unique index if not exists pcr_timeseries_identity_idx
  on pcr_timeseries (underlying, timestamp);
