"""Smoke tests for ledger/schemas.py — verify models instantiate and
validate correctly."""

from datetime import date, datetime

import pytest

from ledger.schemas import (
    AuditLog,
    CommissionLine,
    ConfirmationLevel,
    Counselor,
    CounselorRule,
    CommissionScope,
    Deductions,
    Enrollment,
    FeeModel,
    Installment,
    InstallmentStatus,
    Match,
    MatchAllocation,
    MatchMethod,
    MatchStatus,
    Money,
    PaymentIn,
    PaymentMethod,
    PaymentOut,
    PaymentOutCategory,
    PaymentSource,
    Reminder,
    ReminderChannel,
    ReminderStatus,
    Student,
)


class TestMoney:
    def test_defaults_to_inr(self):
        m = Money(amount_paise=17700000)
        assert m.currency == "INR"

    def test_stores_exact_paise(self):
        m = Money(amount_paise=27848000, currency="INR")
        assert m.amount_paise == 27848000

    def test_foreign_currency(self):
        m = Money(amount_paise=40000, currency="USD")
        assert m.currency == "USD"
        assert m.amount_paise == 40000


class TestStudent:
    def test_minimal(self):
        s = Student(id=1, name="Aarav Sharma")
        assert s.aliases == []
        assert s.counselor_ids == []
        assert s.payer_aliases == []

    def test_full(self):
        s = Student(
            id=42,
            name="Priya Patel",
            aliases=["Priya P"],
            city="Mumbai",
            country="India",
            counselor_ids=[3],
            payer_aliases=["Rajesh Patel", "Patel Industries"],
        )
        assert len(s.payer_aliases) == 2


class TestEnrollment:
    def test_package_with_gst(self):
        e = Enrollment(
            id=1,
            student_id=42,
            program="SAT",
            fee_model=FeeModel.PACKAGE,
            total_fee=Money(amount_paise=23600000, currency="INR"),
            gst_applicable=True,
        )
        assert e.fee_model == FeeModel.PACKAGE
        assert e.total_fee.amount_paise == 23600000

    def test_hourly_no_gst(self):
        e = Enrollment(
            id=2,
            student_id=10,
            program="IB Math",
            fee_model=FeeModel.HOURLY,
            total_fee=Money(amount_paise=40000, currency="USD"),
            gst_applicable=False,
        )
        assert e.fee_model == FeeModel.HOURLY


class TestInstallment:
    def test_open_by_default(self):
        i = Installment(
            id=1,
            enrollment_id=1,
            amount_due=Money(amount_paise=13924000),
        )
        assert i.status == InstallmentStatus.OPEN
        assert i.due_date is None

    def test_with_due_date(self):
        i = Installment(
            id=2,
            enrollment_id=1,
            due_date=date(2026, 3, 15),
            amount_due=Money(amount_paise=13924000),
            status=InstallmentStatus.PAID,
        )
        assert i.due_date.day == 15
        assert i.due_date.month == 3


class TestPaymentIn:
    def test_minimal(self):
        p = PaymentIn(
            id=1,
            source=PaymentSource.BANK,
            amount_paid=Money(amount_paise=17700000),
        )
        assert p.deductions.gateway_fee_paise == 0
        assert p.confirmation == ConfirmationLevel.SCREENSHOT_ONLY

    def test_gateway_with_deductions(self):
        p = PaymentIn(
            id=2,
            source=PaymentSource.GATEWAY,
            method=PaymentMethod.STRIPE,
            payer_name="Rajesh Patel",
            date=date(2026, 1, 10),
            amount_paid=Money(amount_paise=260000, currency="USD"),
            deductions=Deductions(
                gateway_fee_paise=7800,
                gst_on_fee_paise=1404,
            ),
            amount_in_bank_paise=21000000,
            confirmation=ConfirmationLevel.IN_BANK,
        )
        assert p.deductions.gateway_fee_paise == 7800
        assert p.amount_in_bank_paise == 21000000


class TestMatch:
    def test_single_allocation(self):
        m = Match(
            id=1,
            payment_id=1,
            allocations=[MatchAllocation(installment_id=5, allocated_paise=17700000)],
            method=MatchMethod.RULES,
            confidence=0.95,
            reason="Exact amount + fuzzy name match",
        )
        assert len(m.allocations) == 1
        assert m.status == MatchStatus.PENDING_REVIEW

    def test_split_allocation(self):
        m = Match(
            id=2,
            payment_id=3,
            allocations=[
                MatchAllocation(installment_id=10, allocated_paise=13924000),
                MatchAllocation(installment_id=11, allocated_paise=4130000),
            ],
            method=MatchMethod.AI,
            confidence=0.80,
            reason="Parent paying for two children",
            status=MatchStatus.APPROVED,
        )
        assert len(m.allocations) == 2

    def test_confidence_bounds(self):
        with pytest.raises(Exception):
            Match(
                id=1,
                payment_id=1,
                allocations=[],
                method=MatchMethod.AI,
                confidence=1.5,
            )


class TestCounselor:
    def test_with_parsed_rule(self):
        c = Counselor(
            id=1,
            name="Meera Kapoor",
            terms_text="10% on own referrals from Mumbai",
            parsed_rule=CounselorRule(
                rate=0.10,
                scope=CommissionScope.OWN_REFERRALS,
                city="Mumbai",
            ),
        )
        assert c.parsed_rule.rate == 0.10


class TestCommissionLine:
    def test_full(self):
        cl = CommissionLine(
            id=1,
            counselor_id=1,
            payment_id=5,
            base_paise=17700000,
            rate=0.10,
            commission_paise=1770000,
            tds_paise=35400,
            net_paise=1734600,
        )
        assert cl.net_paise == 1734600


class TestPaymentOut:
    def test_faculty_payment(self):
        p = PaymentOut(
            id=1,
            date=date(2026, 2, 28),
            payee="Prof. Anil Kumar",
            category=PaymentOutCategory.FACULTY,
            amount=Money(amount_paise=5000000),
        )
        assert p.category == PaymentOutCategory.FACULTY


class TestReminder:
    def test_defaults(self):
        r = Reminder(
            id=1,
            installment_id=10,
            scheduled_for=date(2026, 3, 12),
            text="Hi, your payment of ₹1,39,240 is due on 15/03.",
        )
        assert r.channel == ReminderChannel.SIMULATED
        assert r.status == ReminderStatus.SCHEDULED


class TestAuditLog:
    def test_full(self):
        a = AuditLog(
            id=1,
            timestamp=datetime(2026, 1, 15, 10, 30, 0),
            actor="matching_ai",
            action="approve_match",
            entity="match:42",
            old_value='{"status": "pending_review"}',
            new_value='{"status": "approved"}',
        )
        assert a.actor == "matching_ai"
