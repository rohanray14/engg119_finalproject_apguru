"""Central configuration for Educore Finance Desk.

All thresholds, fee rates, FX sources, and schedule settings live here.
Validated by Pydantic so typos in env vars fail fast.
"""

from __future__ import annotations

from pydantic import BaseModel, Field


class MatchingConfig(BaseModel):
    auto_match_threshold: float = Field(
        default=0.95,
        description="Confidence >= this auto-matches without review",
    )
    review_threshold: float = Field(
        default=0.50,
        description="Confidence >= this but < auto goes to review queue",
    )
    max_candidates: int = Field(default=5)
    date_window_days: int = Field(default=90)
    name_threshold: int = Field(default=70)
    amount_tolerance_pct: float = Field(default=0.20)


class GatewayFeeConfig(BaseModel):
    payglocal_international_bps: int = 275
    payglocal_inr_bps: int = 125
    stripe_bps: int = 300
    razorpay_bps: int = 300
    bank_transfer_bps: int = 50

    def as_dict(self) -> dict[str, int]:
        return {
            "payglocal_international": self.payglocal_international_bps,
            "payglocal_inr": self.payglocal_inr_bps,
            "stripe": self.stripe_bps,
            "razorpay": self.razorpay_bps,
            "bank_transfer": self.bank_transfer_bps,
        }


class ReminderConfig(BaseModel):
    days_before_due: int = 3
    days_after_overdue: int = 7
    max_auto_reminders: int = 2


class AppConfig(BaseModel):
    matching: MatchingConfig = Field(default_factory=MatchingConfig)
    gateway_fees: GatewayFeeConfig = Field(default_factory=GatewayFeeConfig)
    reminders: ReminderConfig = Field(default_factory=ReminderConfig)
    tds_rate_bps: int = Field(default=200, description="TDS rate in basis points (2%)")
    gst_rate_bps: int = Field(default=1800, description="GST rate in basis points (18%)")
    model: str = Field(default="claude-sonnet-4-6")


# Singleton — import this everywhere
CONFIG = AppConfig()
