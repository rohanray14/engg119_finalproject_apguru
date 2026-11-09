// Types matching the FastAPI response shapes

export interface Meta {
  data_from: string;
  data_to: string;
  default_as_of: string;
  currencies: string[];
}

export interface MonthSnapshot {
  currency: string;
  received_paise: number;
  received_last_month_paise: number;
  expected_paise: number;
  spent_paise: number;
  collection_rate_pct: number | null;
}

export interface OverdueSummary {
  count: number;
  by_currency: { currency: string; amount_paise: number; count: number }[];
  oldest_days: number;
}

export interface MatchingSummary {
  matched: number;
  suggested: number;
  needs_review: number;
  pending_total: number;
  never_matched: number;
}

export interface ForecastWeek {
  week_start: string;
  scheduled_paise: number;
  likely_paise: number;
}

export interface CommissionTotal {
  currency: string;
  earned_paise: number;
  tds_paise: number;
  net_paise: number;
  counselors: number;
  payable_paise?: number;
}

export interface TopOwing {
  student_id: number;
  name: string;
  currency: string;
  owed_paise: number;
  earliest_due: string;
}

export interface LargestUnmatched {
  id: number;
  payer_name: string | null;
  amount_paid_paise: number;
  currency: string;
  date: string;
  method: string | null;
}

export interface Dashboard {
  as_of: string;
  month: MonthSnapshot;
  overdue: OverdueSummary;
  matching: MatchingSummary;
  confirmation: Record<string, number>;
  months: { month: string; expected_paise: number; collected_paise: number }[];
  forecast: ForecastWeek[];
  commissions: CommissionTotal[];
  risk: { high: number; medium: number; low: number };
  reminders: { total: number; overdue: number; needs_approval: number };
  top_owing: TopOwing[];
  largest_unmatched: LargestUnmatched[];
}

export interface Payment {
  payment_id: number;
  payer_name: string | null;
  amount_paid_paise: number;
  currency: string;
  date: string;
  source: string;
  method: string | null;
  gateway_fee_paise: number;
  gst_on_fee_paise: number;
  fx_diff_paise: number;
  tds_paise: number;
  amount_in_bank_paise: number;
  confirmation: string;
}

export interface ReviewItem {
  match_id: number;
  status: string;
  confidence: number;
  method: string;
  reason: string | null;
  reason_text: string;
  has_suggestion: boolean;
  payment: Payment;
}

export interface ReviewQueue {
  auto_matched_count: number;
  auto_match_threshold: number;
  bulk_approve_min_confidence: number;
  items: ReviewItem[];
}

export interface Installment {
  installment_id: number;
  due_date: string | null;
  amount_due_paise: number;
  currency: string;
  status: string;
  enrollment_id: number;
  program: string;
  fee_model: string;
  student_id: number;
  student_name: string;
  remaining_paise: number;
  suggested?: boolean;
  amount_difference_paise?: number;
}

export interface ReviewDetail extends ReviewItem {
  suggested_installments: Installment[];
  other_candidates: Installment[];
}

export interface UserInfo {
  id: string;
  email: string;
  role: string;
  can_approve: boolean;
}

export interface DecisionResult {
  match_id: number;
  status: string;
  allocations: Record<string, unknown>[];
  installment_changes: Record<string, unknown>[];
  unallocated_paise: number;
  commission_lines: number;
}

export interface BulkResult {
  approved: number[];
  skipped: { match_id: number; reason: string }[];
  commission_lines: number;
}
