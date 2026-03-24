const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function apiRequest<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options?.headers || {})
    },
    cache: "no-store"
  });

  if (!response.ok) {
    let message = `Request failed with status ${response.status}`;
    try {
      const body = await response.json();
      message = body.detail || body.message || message;
    } catch {
      // keep status-based message
    }
    throw new Error(message);
  }

  return response.json();
}

export type PCRCurrent = {
  timestamp: string;
  pcr: number;
  total_call_oi: number;
  total_put_oi: number;
  window_pcr: number;
  window_call_oi: number;
  window_put_oi: number;
  reference_strike: number | null;
  window_strike_count: number;
};

export type PCRHistoryPoint = {
  timestamp: string;
  pcr: number;
};

export type OIStrikeRow = {
  strike_price: number;
  call_oi: number;
  put_oi: number;
  call_ltp?: number;
  put_ltp?: number;
};

export type OIChangeRow = {
  strike_price: number;
  call_oi: number;
  put_oi: number;
  delta_call_oi: number;
  delta_put_oi: number;
};

export type OIGroupedRow = {
  range: string;
  call_oi: number;
  put_oi: number;
  pcr: number;
};

export type OIResponse<T> = {
  spot_ltp: number | null;
  rows: T[];
};

export type LevelsResponse = {
  resistance: { strike_price: number; call_oi: number; score: number }[];
  support: { strike_price: number; put_oi: number; score: number }[];
  reference_strike: number | null;
};

export type SentimentResponse = {
  sentiment: "Bullish" | "Bearish" | "Neutral";
  pcr_trend: string;
  latest_pcr: number;
  window_pcr: number;
  confidence: "Low" | "Medium" | "High";
  reference_strike: number | null;
};

export type SchedulerStatus = {
  running: boolean;
  interval_minutes: number;
  underlying: string;
  supported_underlyings: string[];
  last_run: string | null;
  next_run: string | null;
  data_status?: {
    latest_snapshot_timestamp: string | null;
    snapshot_contracts: number;
    latest_pcr_timestamp: string | null;
    latest_pcr: number | null;
    total_call_oi: number | null;
    total_put_oi: number | null;
    expiry: string | null;
  } | null;
  last_catch_up?: {
    underlying: string;
    lookback_days: number;
    from_timestamp: string | null;
    to_timestamp: string;
    snapshots_inserted: number;
    pcr_points_inserted: number;
    catch_up_performed: boolean;
  } | null;
};

export type AuthStatus = {
  authenticated: boolean;
  token_valid: boolean;
  login_required: boolean;
  underlying: string | null;
};

export type AnalyticsOverview = {
  underlying: string;
  today_pcr: number | null;
  yesterday_pcr: number | null;
  latest_pcr: number | null;
  window_pcr: number;
  pcr_change: number | null;
  call_oi_change: number;
  put_oi_change: number;
  reference_strike: number | null;
  spot_ltp: number | null;
  stretch_signal: string;
  directional_bias: string;
};

export type AnalyticsFlowPoint = {
  underlying: string;
  timestamp: string;
  pcr: number;
  total_call_oi: number;
  total_put_oi: number;
  delta_call_oi: number;
  delta_put_oi: number;
};

export type SlabPoint = {
  strike_price: number;
  oi: number;
  delta_oi: number;
  side: "CE" | "PE";
};

export type SlabAnalytics = {
  reference_strike: number | null;
  call_buildup: SlabPoint[];
  put_buildup: SlabPoint[];
  bullish_target: SlabPoint | null;
  bearish_target: SlabPoint | null;
};

export type ProbabilityEstimate = {
  strike_price: number;
  call_ltp: number;
  put_ltp: number;
  distance_from_spot: number;
  probability_touch: number;
  probability_expire_near: number;
};

export type ProbabilityAnalytics = {
  underlying: string;
  reference_strike: number | null;
  spot_ltp: number | null;
  days_to_expiry: number | null;
  expected_move: number | null;
  method: string;
  estimates: ProbabilityEstimate[];
};

export type MarketStatus = {
  underlying: string;
  timezone: string;
  timestamp: string;
  market_open: boolean;
  phase: "preopen" | "live" | "closed" | "weekend";
  next_open: string | null;
  next_close: string | null;
};

export const fetchPCRCurrent = () => apiRequest<PCRCurrent>("/pcr/current");
export const fetchPCRHistory = (limit = 50) => apiRequest<PCRHistoryPoint[]>(`/pcr/history?limit=${limit}`);
export const fetchOIStrikes = () => apiRequest<OIResponse<OIStrikeRow>>("/oi/strikes");
export const fetchOIChange = () => apiRequest<OIResponse<OIChangeRow>>("/oi/change");
export const fetchOIGrouped = (bucketSize = 150) => apiRequest<OIGroupedRow[]>(`/oi/grouped?bucket_size=${bucketSize}`);
export const fetchLevels = () => apiRequest<LevelsResponse>("/levels");
export const fetchSentiment = () => apiRequest<SentimentResponse>("/sentiment");
export const fetchSchedulerStatus = () => apiRequest<SchedulerStatus>("/scheduler/status");
export const fetchAuthStatus = () => apiRequest<AuthStatus>("/auth/status");
export const fetchAnalyticsOverview = () => apiRequest<AnalyticsOverview>("/analytics/overview");
export const fetchAnalyticsFlow = (limit = 32) => apiRequest<AnalyticsFlowPoint[]>(`/analytics/flow?limit=${limit}`);
export const fetchSlabAnalytics = () => apiRequest<SlabAnalytics>("/analytics/slabs");
export const fetchProbabilityAnalytics = () => apiRequest<ProbabilityAnalytics>("/analytics/probability");
export const fetchMarketStatus = () => apiRequest<MarketStatus>("/market/status");
export const startScheduler = () => apiRequest<SchedulerStatus>("/scheduler/start", { method: "POST" });
export const stopScheduler = () => apiRequest<SchedulerStatus>("/scheduler/stop", { method: "POST" });
export const updateSchedulerConfig = (interval_minutes: number, underlying: string) =>
  apiRequest<SchedulerStatus>("/scheduler/config", {
    method: "POST",
    body: JSON.stringify({ interval_minutes, underlying })
  });

export const getLoginUrl = () => `${API_BASE}/login`;
