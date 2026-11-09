"""Pydantic models for every ledger entity (SPEC.md section 4).

All monetary amounts are stored as **integer paise** (or the smallest unit
of the relevant currency) paired with a currency code, so no floating-point
rounding can occur.
"""

from __future__ import annotations

import datetime as _dt
import enum
from typing import Optional

from pydantic import BaseModel, Field

# ---------------------------------------------------------------------------
# Value objects
# ---------------------------------------------------------------------------

class Money(BaseModel):
    """An amount in the smallest currency unit (e.g. paise for INR, cents for
    USD) plus a three-letter currency code."""
    amount_paise: int = Field(description="Amount in smallest currency unit")
    currency: str = Field(default="INR", description="ISO 4217 currency code")


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class FeeModel(str, enum.Enum):
    PACKAGE = "package"
    HOURLY = "hourly"


class InstallmentStatus(str, enum.Enum):
    OPEN = "open"
    PARTIAL = "partial"
    PAID = "paid"
    OVERDUE = "overdue"


class PaymentSource(str, enum.Enum):
    BANK = "bank"
    GATEWAY = "gateway"
    CASH = "cash"
    SCREENSHOT = "screenshot"


class PaymentMethod(str, enum.Enum):
    NEFT = "neft"
    UPI = "upi"
    IMPS = "imps"
    CASH = "cash"
    CHEQUE = "cheque"
    PAYGLOCAL = "payglocal"
    STRIPE = "stripe"
    RAZORPAY = "razorpay"
    OTHER = "other"


class ConfirmationLevel(str, enum.Enum):
    SCREENSHOT_ONLY = "screenshot_only"
    SEEN_BY_GATEWAY = "seen_by_gateway"
    IN_BANK = "in_bank"


class MatchMethod(str, enum.Enum):
    RULES = "rules"
    AI = "ai"
    HUMAN = "human"


class MatchStatus(str, enum.Enum):
    AUTO = "auto"
    PENDING_REVIEW = "pending_review"
    APPROVED = "approved"
    REJECTED = "rejected"


class CommissionScope(str, enum.Enum):
    OWN_REFERRALS = "own_referrals"
    CITY = "city"


class PaymentOutCategory(str, enum.Enum):
    FACULTY = "faculty"
    COMMISSION = "commission"
    REFUND = "refund"
    RENT = "rent"
    ADS = "ads"
    TAX = "tax"
    SOFTWARE = "software"
    OTHER = "other"


class ReminderChannel(str, enum.Enum):
    WHATSAPP = "whatsapp"
    SIMULATED = "simulated"


class ReminderStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    SENT = "sent"
    REPLIED = "replied"
    CANCELLED = "cancelled"


# ---------------------------------------------------------------------------
# Core entities
# ---------------------------------------------------------------------------

class Student(BaseModel):
    id: int
    name: str
    aliases: list[str] = Field(default_factory=list)
    city: Optional[str] = None
    country: Optional[str] = None
    counselor_ids: list[int] = Field(default_factory=list)
    payer_aliases: list[str] = Field(default_factory=list)


class Enrollment(BaseModel):
    id: int
    student_id: int
    program: str
    fee_model: FeeModel
    total_fee: Money
    gst_applicable: bool = True


class Installment(BaseModel):
    id: int
    enrollment_id: int
    due_date: Optional[_dt.date] = None
    amount_due: Money
    status: InstallmentStatus = InstallmentStatus.OPEN


# ---------------------------------------------------------------------------
# Payments in
# ---------------------------------------------------------------------------

class Deductions(BaseModel):
    """Fees/taxes/differences subtracted between what the payer sent and what
    arrived in the Educore bank account."""
    gateway_fee_paise: int = 0
    gst_on_fee_paise: int = 0
    fx_diff_paise: int = 0
    tds_paise: int = 0


class PaymentIn(BaseModel):
    id: int
    source: PaymentSource
    method: Optional[PaymentMethod] = None
    payer_name: Optional[str] = None
    date: Optional[_dt.date] = None
    amount_paid: Money
    deductions: Deductions = Field(default_factory=Deductions)
    amount_in_bank_paise: Optional[int] = Field(
        default=None,
        description="Actual INR amount received in the bank account",
    )
    confirmation: ConfirmationLevel = ConfirmationLevel.SCREENSHOT_ONLY


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

class MatchAllocation(BaseModel):
    """One slice of a payment allocated to a specific installment."""
    installment_id: int
    allocated_paise: int


class Match(BaseModel):
    id: int
    payment_id: int
    allocations: list[MatchAllocation]
    method: MatchMethod
    confidence: float = Field(ge=0.0, le=1.0)
    reason: str = ""
    status: MatchStatus = MatchStatus.PENDING_REVIEW


# ---------------------------------------------------------------------------
# Counselors & commissions
# ---------------------------------------------------------------------------

class CounselorRule(BaseModel):
    """Structured version of a counselor's free-text commission terms."""
    rate: float = Field(description="Commission rate, e.g. 0.10 for 10%")
    scope: CommissionScope = CommissionScope.OWN_REFERRALS
    city: Optional[str] = None
    split: Optional[float] = Field(
        default=None,
        description="If two referrers split, this counselor's fraction",
    )


class Counselor(BaseModel):
    id: int
    name: str
    terms_text: str = ""
    parsed_rule: Optional[CounselorRule] = None


class CommissionLine(BaseModel):
    id: int
    counselor_id: int
    payment_id: int
    base_paise: int
    rate: float
    commission_paise: int
    refund_deduction_paise: int = 0
    tds_paise: int = 0
    net_paise: int = 0


# ---------------------------------------------------------------------------
# Payments out
# ---------------------------------------------------------------------------

class PaymentOut(BaseModel):
    id: int
    date: Optional[_dt.date] = None
    payee: str
    category: PaymentOutCategory
    amount: Money


# ---------------------------------------------------------------------------
# Reminders
# ---------------------------------------------------------------------------

class Reminder(BaseModel):
    id: int
    installment_id: int
    scheduled_for: Optional[_dt.date] = None
    channel: ReminderChannel = ReminderChannel.SIMULATED
    text: str = ""
    status: ReminderStatus = ReminderStatus.SCHEDULED


# ---------------------------------------------------------------------------
# Audit log
# ---------------------------------------------------------------------------

class AuditLog(BaseModel):
    id: int
    timestamp: _dt.datetime
    actor: str = Field(description="user or agent name")
    action: str
    entity: str = Field(description="e.g. 'match:42', 'payment_in:7'")
    old_value: Optional[str] = None
    new_value: Optional[str] = None
