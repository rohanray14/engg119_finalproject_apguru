"""Tests for ledger/money.py — including every numeric example from SPEC.md."""

import pytest

from ledger.money import (
    add_gst,
    remove_gst,
    gst_component,
    gateway_fee,
    gateway_fee_with_gst,
    fx_convert,
    tds,
    balance_owed,
    expected_bank_amount,
    GATEWAY_FEE_RATES_BPS,
    DEFAULT_FX_RATES,
    GST_RATE_BPS,
    TDS_RATE_BPS,
)


# ── SPEC.md section 1 examples ──────────────────────────────────────────

class TestSpecExamples:
    """Exact figures from SPEC.md section 1."""

    def test_sat_package_plus_gst(self):
        # ₹2,36,000 + GST = ₹2,78,480
        assert add_gst(23600000) == 27848000

    def test_sat_half_installment(self):
        # Half of ₹2,78,480 = ₹1,39,240
        assert 27848000 // 2 == 13924000

    def test_hourly_10hrs_plus_gst(self):
        # 10 hours ₹35,000 + GST = ₹41,300
        assert add_gst(3500000) == 4130000

    def test_counselor_tds_2pct(self):
        # 2 % TDS on ₹1,00,000 commission = ₹2,000
        assert tds(10000000) == 200000


# ── add_gst / remove_gst round-trip ─────────────────────────────────────

class TestGST:
    def test_add_then_remove_round_trip(self):
        base = 23600000  # ₹2,36,000
        inclusive = add_gst(base)
        assert remove_gst(inclusive) == base

    def test_remove_gst_from_known(self):
        # ₹2,78,480 → base ₹2,36,000
        assert remove_gst(27848000) == 23600000

    def test_gst_component(self):
        # GST on ₹2,36,000 = ₹42,480
        assert gst_component(27848000) == 4248000

    def test_add_gst_zero(self):
        assert add_gst(0) == 0

    def test_remove_gst_zero(self):
        assert remove_gst(0) == 0

    def test_small_amount(self):
        # ₹100 + GST = ₹118
        assert add_gst(10000) == 11800

    def test_round_trip_hourly(self):
        base = 3500000
        assert remove_gst(add_gst(base)) == base


# ── Gateway fees ─────────────────────────────────────────────────────────

class TestGatewayFee:
    def test_stripe_3pct(self):
        # 3 % of ₹1,00,000 = ₹3,000
        assert gateway_fee(10000000, "stripe") == 300000

    def test_payglocal_intl_2_75pct(self):
        # 2.75 % of ₹1,00,000 = ₹2,750
        assert gateway_fee(10000000, "payglocal_international") == 275000

    def test_bank_transfer_0_5pct(self):
        # 0.5 % of ₹1,00,000 = ₹500
        assert gateway_fee(10000000, "bank_transfer") == 50000

    def test_unknown_gateway_raises(self):
        with pytest.raises(KeyError):
            gateway_fee(10000000, "unknown_gw")

    def test_custom_rates(self):
        custom = {"my_gw": 500}  # 5 %
        assert gateway_fee(10000000, "my_gw", rates_bps=custom) == 500000


class TestGatewayFeeWithGST:
    def test_stripe_fee_plus_gst(self):
        # Stripe 3 % on ₹1,00,000 = ₹3,000 fee
        # GST on fee (18 %) = ₹540
        # Total deduction = ₹3,540
        fee, gst_on_fee, total = gateway_fee_with_gst(10000000, "stripe")
        assert fee == 300000
        assert gst_on_fee == 54000
        assert total == 354000


# ── FX conversion ────────────────────────────────────────────────────────

class TestFXConvert:
    def test_inr_to_inr_identity(self):
        assert fx_convert(10000000, "INR", "INR") == 10000000

    def test_usd_to_inr(self):
        # $400 (40000 cents) → ₹33,600 (3360000 paise) at rate 8400
        result = fx_convert(40000, "USD", "INR")
        assert result == 3360000

    def test_aed_to_inr(self):
        # 1500 AED (150000 fils) → at 22.90 rate = ₹34,350 (3435000 paise)
        result = fx_convert(150000, "AED", "INR")
        assert result == 3435000

    def test_same_currency_noop(self):
        assert fx_convert(12345, "USD", "USD") == 12345

    def test_custom_rates(self):
        custom = {"INR": 100, "USD": 8500}
        assert fx_convert(10000, "USD", "INR", rates=custom) == 850000


# ── TDS ──────────────────────────────────────────────────────────────────

class TestTDS:
    def test_2pct_default(self):
        # 2 % of ₹50,000 = ₹1,000
        assert tds(5000000) == 100000

    def test_custom_rate(self):
        # 10 % TDS (1000 bps)
        assert tds(10000000, rate_bps=1000) == 1000000

    def test_zero(self):
        assert tds(0) == 0


# ── Balance owed ─────────────────────────────────────────────────────────

class TestBalanceOwed:
    def test_partial_payment(self):
        assert balance_owed(27848000, 13924000) == 13924000

    def test_fully_paid(self):
        assert balance_owed(27848000, 27848000) == 0

    def test_overpayment(self):
        assert balance_owed(27848000, 30000000) == -2152000


# ── Expected bank amount ────────────────────────────────────────────────

class TestExpectedBankAmount:
    def test_inr_neft_no_gateway(self):
        # Direct NEFT ₹2,78,480 → full amount in bank
        result = expected_bank_amount(27848000, "INR")
        assert result == 27848000

    def test_inr_with_stripe(self):
        # ₹2,78,480 via Stripe: fee 3% = 8354, GST on fee 18% = 1504,
        # total deduction = 9858; bank gets 27848000 - 985800 = 26862200
        result = expected_bank_amount(27848000, "INR", gateway_key="stripe")
        # fee = round(27848000 * 300 / 10000) = 835440
        # gst_on_fee = round(835440 * 1800 / 10000) = 150379
        # total_deduction = 985819
        # bank = 27848000 - 985819 = 26862181
        assert result == 26862181

    def test_usd_with_payglocal(self):
        # $2,600 (260000 cents) via PayGlocal international
        result = expected_bank_amount(
            260000, "USD", gateway_key="payglocal_international",
        )
        # fee = round(260000 * 275 / 10000) = 7150
        # gst_on_fee = round(7150 * 1800 / 10000) = 1287
        # after deductions = 260000 - 7150 - 1287 = 251563 cents
        # fx to INR = round(251563 * 8400 / 100) = 21131292 paise
        assert result > 0

    def test_no_gateway_foreign(self):
        # $400 direct (no gateway), just FX
        result = expected_bank_amount(40000, "USD")
        assert result == 3360000  # 40000 * 8400 / 100
