"""Tests for the commissions agent."""

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from agents.commissions import parse_terms, ParsedRule, TDS_RATE


class TestParseTerms:
    def test_simple_rate(self):
        rule = parse_terms("10% commission on all referrals")
        assert rule.rate == 0.10
        assert rule.scope == "own_referrals"

    def test_twenty_percent(self):
        rule = parse_terms("20% commission")
        assert rule.rate == 0.20

    def test_city_scope(self):
        rule = parse_terms("15% on Mumbai students")
        assert rule.rate == 0.15
        assert rule.scope == "city"
        assert rule.city == "Mumbai"

    def test_split(self):
        rule = parse_terms("10% split 50/50 with Amit")
        assert rule.rate == 0.10
        assert rule.split == 0.5

    def test_uneven_split(self):
        rule = parse_terms("20% split 60/40 with partner")
        assert rule.rate == 0.20
        assert rule.split == 0.6

    def test_empty_terms(self):
        rule = parse_terms("")
        assert rule.rate == 0.0

    def test_no_percent(self):
        rule = parse_terms("commission to be discussed")
        assert rule.rate == 0.0

    def test_decimal_rate(self):
        rule = parse_terms("7.5% commission on all referrals")
        assert rule.rate == 0.075

    def test_delhi_city(self):
        rule = parse_terms("10% for Delhi students")
        assert rule.scope == "city"
        assert rule.city == "Delhi"

    def test_split_keyword_default(self):
        rule = parse_terms("10% split with Raj")
        assert rule.split == 0.5  # default 50/50


class TestTDS:
    def test_tds_rate(self):
        assert TDS_RATE == 0.02

    def test_tds_calculation(self):
        commission = 100000  # ₹1,000 in paise
        tds = int(commission * TDS_RATE)
        assert tds == 2000  # ₹20

    def test_net_after_tds(self):
        commission = 500000  # ₹5,000
        tds = int(commission * TDS_RATE)
        net = commission - tds
        assert net == 490000  # ₹4,900
