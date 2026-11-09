"""Pure, deterministic money-math functions.

Every function works with **integer paise** (or smallest currency unit) to
avoid floating-point rounding.  No function calls an LLM.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# GST (18 %)
# ---------------------------------------------------------------------------

GST_RATE_BPS = 1800  # 18.00 % in basis points


def add_gst(base_paise: int) -> int:
    """Return the GST-inclusive amount: base * 1.18 (rounded to nearest paise)."""
    return base_paise + _pct_bps(base_paise, GST_RATE_BPS)


def remove_gst(inclusive_paise: int) -> int:
    """Return the base (pre-GST) amount from a GST-inclusive figure.

    base = inclusive * 100 / 118, rounded to nearest paise.
    """
    return _round_div(inclusive_paise * 10000, 11800)


def gst_component(inclusive_paise: int) -> int:
    """Return just the GST portion of a GST-inclusive amount."""
    return inclusive_paise - remove_gst(inclusive_paise)


# ---------------------------------------------------------------------------
# Gateway fees
# ---------------------------------------------------------------------------

# Default rates as basis points (configurable).
GATEWAY_FEE_RATES_BPS: dict[str, int] = {
    "payglocal_international": 275,  # 2.75 %
    "payglocal_inr": 125,           # 1.25 %
    "stripe": 300,                   # 3.00 %
    "razorpay": 300,                 # 3.00 %
    "bank_transfer": 50,             # 0.50 %
}


def gateway_fee(
    amount_paise: int,
    gateway_key: str,
    rates_bps: dict[str, int] | None = None,
) -> int:
    """Compute the gateway fee (before GST on fee) for *amount_paise*.

    Returns fee in paise.  Raises ``KeyError`` if the gateway key is unknown.
    """
    table = rates_bps or GATEWAY_FEE_RATES_BPS
    return _pct_bps(amount_paise, table[gateway_key])


def gateway_fee_with_gst(
    amount_paise: int,
    gateway_key: str,
    rates_bps: dict[str, int] | None = None,
) -> tuple[int, int, int]:
    """Return ``(fee, gst_on_fee, total_deduction)`` all in paise."""
    fee = gateway_fee(amount_paise, gateway_key, rates_bps)
    gst_on_fee = _pct_bps(fee, GST_RATE_BPS)
    return fee, gst_on_fee, fee + gst_on_fee


# ---------------------------------------------------------------------------
# FX conversion
# ---------------------------------------------------------------------------

# Indicative rates: 1 foreign unit → paise (i.e. INR * 100).
# INR is identity.
DEFAULT_FX_RATES: dict[str, int] = {
    "INR": 100,           # 1 INR = 100 paise
    "USD": 8400,          # 1 USD ≈ ₹84
    "AED": 2290,          # 1 AED ≈ ₹22.90
    "GBP": 10700,         # 1 GBP ≈ ₹107
    "EUR": 9200,          # 1 EUR ≈ ₹92
    "SGD": 6300,          # 1 SGD ≈ ₹63
}


def fx_convert(
    amount_paise: int,
    from_currency: str,
    to_currency: str = "INR",
    rates: dict[str, int] | None = None,
) -> int:
    """Convert *amount_paise* (in *from_currency* smallest unit) to
    *to_currency* smallest unit using the rates table.

    Each rate = how many **paise** (INR smallest unit) one unit of the
    foreign currency is worth.  For INR the rate is 100 (identity).
    """
    table = rates or DEFAULT_FX_RATES
    if from_currency == to_currency:
        return amount_paise
    # Convert to INR paise first, then to target.
    inr_paise = _round_div(amount_paise * table[from_currency], 100)
    if to_currency == "INR":
        return inr_paise
    return _round_div(inr_paise * 100, table[to_currency])


# ---------------------------------------------------------------------------
# TDS (Tax Deducted at Source)
# ---------------------------------------------------------------------------

TDS_RATE_BPS = 200  # 2 %


def tds(amount_paise: int, rate_bps: int = TDS_RATE_BPS) -> int:
    """TDS withheld on *amount_paise*."""
    return _pct_bps(amount_paise, rate_bps)


# ---------------------------------------------------------------------------
# Balance helpers
# ---------------------------------------------------------------------------

def balance_owed(total_due_paise: int, total_paid_paise: int) -> int:
    """Simple remaining balance (may be negative for overpayment)."""
    return total_due_paise - total_paid_paise


def expected_bank_amount(
    paid_paise: int,
    currency: str,
    gateway_key: str | None = None,
    gst_on_payment: bool = False,
    payer_tds_bps: int = 0,
    rates_bps: dict[str, int] | None = None,
    fx_rates: dict[str, int] | None = None,
) -> int:
    """Estimate INR paise arriving in the bank account after all deductions.

    Pipeline: paid amount → subtract gateway fee+GST on fee → FX to INR.

    *payer_tds_bps*: if the payer (e.g. a company) withholds TDS before
    sending, the amount they actually send is already reduced; this param
    lets us model that the paid amount is *after* payer TDS so we don't
    double-count.  Set to 0 (default) for normal payers.
    """
    amount = paid_paise

    # Gateway deductions (fee + GST on fee)
    if gateway_key is not None:
        _fee, _gst_on_fee, total_deduction = gateway_fee_with_gst(
            amount, gateway_key, rates_bps,
        )
        amount -= total_deduction

    # Convert to INR
    amount = fx_convert(amount, currency, "INR", fx_rates)

    return amount


# ---------------------------------------------------------------------------
# Amount explanation (deduction stories)
# ---------------------------------------------------------------------------

_PARTIAL_FRACTIONS = [0.50, 0.60, 0.75]
_TDS_RATE_10PCT = 1000  # 10% in basis points


def explain_amount(
    payment_paise: int,
    installment_paise: int,
    gst_applicable: bool = True,
    tolerance_paise: int = 2,
) -> list[dict]:
    """Compute which deduction stories explain the gap between a payment
    amount and an installment amount.

    Returns a list of explanations, each a dict with:
      - story: str (e.g. "exact", "tds_10pct", "partial_50pct")
      - residual_paise: int (unexplained gap, 0 = perfect fit)
      - score: float (0.0–1.0, higher = better fit)
    """
    explanations = []

    # 1. Exact match
    residual = abs(payment_paise - installment_paise)
    if residual <= tolerance_paise:
        explanations.append({
            "story": "exact",
            "residual_paise": residual,
            "score": 1.0,
        })

    # 2. TDS 10% on pre-GST base
    # Generator: payer_tds = round(base * 0.10) where base = remove_gst(installment)
    # amount_sent = installment - payer_tds
    if gst_applicable:
        base = remove_gst(installment_paise)
        payer_tds = round(base * 0.10)
    else:
        payer_tds = round(installment_paise * 0.10)
    tds_adjusted = installment_paise - payer_tds
    residual = abs(payment_paise - tds_adjusted)
    if residual <= tolerance_paise:
        explanations.append({
            "story": "tds_10pct",
            "residual_paise": residual,
            "expected_paise": tds_adjusted,
            "tds_paise": payer_tds,
            "score": 0.9,
        })

    # 3. Partial payment (common fractions)
    if installment_paise > 0:
        for frac in _PARTIAL_FRACTIONS:
            expected = round(installment_paise * frac)
            residual = abs(payment_paise - expected)
            if residual <= tolerance_paise:
                explanations.append({
                    "story": f"partial_{int(frac*100)}pct",
                    "residual_paise": residual,
                    "expected_paise": expected,
                    "fraction": frac,
                    "score": 0.8,
                })

    return explanations


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _pct_bps(amount_paise: int, bps: int) -> int:
    """Percentage in basis points: amount * bps / 10_000, rounded."""
    return _round_div(amount_paise * bps, 10_000)


def _round_div(numerator: int, denominator: int) -> int:
    """Integer division with rounding to nearest (banker's rounding on .5)."""
    if denominator == 0:
        raise ZeroDivisionError("denominator is zero")
    # Standard round-half-to-even via Python's built-in round().
    return round(numerator / denominator)
