"""Property-based tests for money math using Hypothesis.

Ensures invariants hold across random inputs:
- GST round-trip: add then remove ≈ identity
- Gateway fee + GST ≤ payment amount
- FX identity: same-currency conversion is no-op
- TDS is always ≤ amount
- Balance owed can go negative (overpayment)
"""

import pytest

try:
    from hypothesis import given, assume, settings
    from hypothesis.strategies import integers
    HAS_HYPOTHESIS = True
except ImportError:
    HAS_HYPOTHESIS = False

from ledger.money import (
    add_gst, remove_gst, gst_component,
    gateway_fee, gateway_fee_with_gst,
    fx_convert, tds, balance_owed,
    _pct_bps, _round_div,
)

pytestmark = pytest.mark.skipif(not HAS_HYPOTHESIS, reason="hypothesis not installed")

# Strategy for realistic paise amounts (1 paise to ₹10 crore)
paise = integers(min_value=1, max_value=1_000_000_000)
small_paise = integers(min_value=1, max_value=100_000_000)


if HAS_HYPOTHESIS:
    @given(amount=paise)
    @settings(max_examples=200)
    def test_gst_roundtrip(amount):
        """add_gst then remove_gst should return ~original (within ±1 paise)."""
        inclusive = add_gst(amount)
        recovered = remove_gst(inclusive)
        assert abs(recovered - amount) <= 1

    @given(amount=paise)
    @settings(max_examples=200)
    def test_gst_component_identity(amount):
        """gst_component(add_gst(x)) should equal add_gst(x) - x (within ±1)."""
        inclusive = add_gst(amount)
        gst_part = gst_component(inclusive)
        assert abs(gst_part - (inclusive - amount)) <= 1

    @given(amount=small_paise)
    @settings(max_examples=200)
    def test_gateway_fee_less_than_amount(amount):
        """Gateway fee + GST on fee should never exceed the payment."""
        for gw in ["payglocal_international", "stripe", "razorpay", "bank_transfer"]:
            fee, gst_on_fee, total = gateway_fee_with_gst(amount, gw)
            assert fee >= 0
            assert gst_on_fee >= 0
            assert total == fee + gst_on_fee
            assert total <= amount  # fee can't exceed payment

    @given(amount=paise)
    @settings(max_examples=200)
    def test_fx_identity(amount):
        """Converting INR→INR should return the same amount."""
        assert fx_convert(amount, "INR", "INR") == amount

    @given(amount=small_paise)
    @settings(max_examples=200)
    def test_fx_roundtrip_approximate(amount):
        """USD→INR→USD should be approximately the original (within rounding)."""
        inr = fx_convert(amount, "USD", "INR")
        back = fx_convert(inr, "INR", "USD")
        # Allow 1% tolerance due to integer rounding
        assert abs(back - amount) <= max(amount * 0.01, 2)

    @given(amount=paise)
    @settings(max_examples=200)
    def test_tds_less_than_amount(amount):
        """TDS should always be less than the amount."""
        t = tds(amount)
        assert 0 <= t <= amount

    @given(due=paise, paid=paise)
    @settings(max_examples=200)
    def test_balance_owed_sign(due, paid):
        """Balance owed is positive when underpaid, negative when overpaid."""
        b = balance_owed(due, paid)
        if paid < due:
            assert b > 0
        elif paid > due:
            assert b < 0
        else:
            assert b == 0

    @given(amount=paise, bps=integers(min_value=0, max_value=10000))
    @settings(max_examples=200)
    def test_pct_bps_non_negative(amount, bps):
        """Percentage in basis points should be non-negative for positive inputs."""
        result = _pct_bps(amount, bps)
        assert result >= 0

    @given(amount=integers(min_value=100, max_value=1_000_000_000))
    @settings(max_examples=200)
    def test_add_gst_increases(amount):
        """Adding GST should always increase the amount (for amounts >= ₹1)."""
        assert add_gst(amount) > amount
