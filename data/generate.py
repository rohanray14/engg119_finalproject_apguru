#!/usr/bin/env python3
"""Fake-data generator for Educore Finance Desk.

Produces ~200 students, enrollments, installments, ~20 counselors,
~400 incoming payments (bank lines + gateway batches), ~60 outgoing payments,
and a messy "tracker" CSV.  Every pattern described in SPEC.md section 3 is
reproduced.  Each payment is tagged with its case type(s) for eval scoring.

Usage:
    python data/generate.py --seed 42
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import random
import sys
from collections import Counter
from datetime import date, timedelta
from pathlib import Path

# Ensure project root is on sys.path so we can import ledger.*
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from ledger.money import (
    add_gst,
    gateway_fee_with_gst,
    tds as compute_tds,
    GATEWAY_FEE_RATES_BPS,
)

# ---------------------------------------------------------------------------
# Constants & pools
# ---------------------------------------------------------------------------

FIRST_NAMES = [
    "Aarav", "Aditi", "Aisha", "Akash", "Ananya", "Arjun", "Bhavya", "Charu",
    "Deepak", "Diya", "Esha", "Farhan", "Gauri", "Harsh", "Isha", "Jatin",
    "Kavya", "Kiran", "Lakshmi", "Manish", "Meera", "Neel", "Nisha", "Omkar",
    "Pallavi", "Pranav", "Priya", "Rahul", "Riya", "Rohan", "Sahil", "Sakshi",
    "Shreya", "Siddharth", "Simran", "Sneha", "Tanvi", "Utkarsh", "Varun",
    "Vidya", "Vikram", "Yash", "Zara", "Aditya", "Ankita", "Arnav", "Dhruv",
    "Ishaan", "Kriti", "Mohit", "Neha", "Pooja", "Rajat", "Ritika", "Sanya",
    "Swati", "Tanya", "Tushar", "Vaishnavi", "Vivek",
]

LAST_NAMES = [
    "Sharma", "Patel", "Gupta", "Singh", "Kumar", "Reddy", "Nair", "Joshi",
    "Mehta", "Chopra", "Iyer", "Menon", "Pillai", "Shah", "Rao", "Desai",
    "Kulkarni", "Chatterjee", "Mukherjee", "Das", "Srinivasan", "Verma",
    "Agarwal", "Kapoor", "Malhotra", "Bhatia", "Saxena", "Bansal", "Khanna",
    "Thakur",
]

COMPANY_NAMES = [
    "TechServe Solutions Pvt Ltd", "Meridian Corp", "GlobalEd Consulting",
    "Bright Future Inc", "Atlas Services LLC", "Pinnacle Trading Co",
]

INDIA_CITIES = [
    ("Mumbai", "India"), ("Delhi", "India"), ("Bangalore", "India"),
    ("Bengaluru", "India"), ("Chennai", "India"), ("Hyderabad", "India"),
    ("Pune", "India"), ("Kolkata", "India"), ("Ahmedabad", "India"),
    ("Jaipur", "India"),
]

OVERSEAS_CITIES = [
    ("Dubai", "UAE"), ("Abu Dhabi", "UAE"), ("Sharjah", "UAE"),
    ("New York", "USA"), ("San Francisco", "USA"), ("Houston", "USA"),
    ("Singapore", "Singapore"), ("London", "UK"),
]

# Messy city/country variants (SPEC: "Dubai" in country column, Bangalore/Bengaluru)
CITY_MESS: dict[str, list[str]] = {
    "Dubai": ["Dubai", "dubai", "DXB"],
    "Bangalore": ["Bangalore", "Bengaluru", "Blore"],
    "Mumbai": ["Mumbai", "Bombay"],
    "Chennai": ["Chennai", "Madras"],
    "Kolkata": ["Kolkata", "Calcutta"],
}

COUNTRY_MESS: dict[str, list[str]] = {
    "UAE": ["UAE", "Dubai", "U.A.E", "United Arab Emirates"],
    "USA": ["USA", "US", "United States"],
    "India": ["India", "IN"],
    "Singapore": ["Singapore", "SG"],
    "UK": ["UK", "United Kingdom"],
}

PROGRAMS_PACKAGE = ["SAT", "AP", "AMC", "TMUA", "GMAT", "GRE"]
PROGRAMS_HOURLY = ["IB Math", "IB Physics", "IB Chemistry", "IB Economics",
                   "IGCSE Math", "IGCSE Physics", "A Level Math",
                   "A Level Physics", "A Level Chemistry"]

# Common INR amounts (GST-inclusive, in paise)
COMMON_INR_PAISE = [
    17700000, 23600000, 15000000, 4130000, 11800000, 22420000,
    14160000, 5900000, 24780000, 27848000, 13924000,
]

# Foreign amounts (in smallest unit: cents / fils)
COMMON_USD_CENTS = [40000, 260000, 140000, 180000, 240000]   # kept for safety_cases
COMMON_AED_FILS  = [150000, 480000, 900000]                 # kept for safety_cases

# Payment method weights (SPEC section 3)
METHOD_WEIGHTS = {
    "neft": 35, "stripe": 23, "payglocal": 20, "blank": 12,
    "cash": 6, "razorpay": 2, "upi": 1, "cheque": 1,
}

# Gateway key mapping for fee calculation
METHOD_TO_GATEWAY_KEY = {
    "stripe": "stripe",
    "payglocal": "payglocal_international",
    "razorpay": "razorpay",
    "neft": "bank_transfer",
    "upi": "bank_transfer",
}

PAYMENT_OUT_CATEGORIES = [
    ("faculty", 25), ("rent", 5), ("ads", 8), ("tax", 6),
    ("software", 5), ("refund", 6), ("other", 5),
]

# Counselor types and their terms templates:
# - "referral": gets a cut of students they personally referred (any city)
# - "city_all": gets a cut of ALL students in a city (consultant/agency deal)
# - "city_referral": gets a cut only of students they referred in their city
# - "student_referral": a former student who refers new students
# - "split": shared referral credit with another counselor
COUNSELOR_TYPE_WEIGHTS = [
    ("referral", 6),
    ("city_all", 3),
    ("city_referral", 4),
    ("student_referral", 4),
    ("split", 3),
]
COUNSELOR_TEMPLATES = {
    "referral": [
        "10% commission on all own referrals",
        "15% commission, own students only",
        "20% on own referrals, no city override",
    ],
    "city_all": [
        "10% on all {city} students",
        "10% commission on every {city} enrollment regardless of referrer",
        "8% on all students from {city}",
    ],
    "city_referral": [
        "20% on own referrals from {city}",
        "15% on own students from {city}",
    ],
    "student_referral": [
        "5% referral bonus on each student I refer",
        "Rs 5000 per referral (settled as 5% of first fee)",
        "5% on students I refer as alumni",
    ],
    "split": [
        "Split 50-50 with co-referrer, 20% total on own referrals",
        "10% commission on own referrals; 5% on {city} walk-ins",
    ],
}

NAME_TAGS = ["(old)", "(Sat Math)", "(IB)", "(sibling)", "(2nd)", "(retake)"]

# Bank narration templates (SPEC section 3)
NARRATION_TEMPLATES = {
    "neft": "NEFT/{ref}/{payer}/FEE",
    "upi": "UPI/{ref}/{payer}/FEE",
    "imps": "IMPS/{ref}/{payer}/FEE",
    "cash": "CASH/{ref}/{payer}/FEE",
    "payglocal": "FX INWARD/PAYGLOCAL/{ref}/{payer}/FEE",
    "stripe": "FX INWARD/STRIPE/{ref}/{payer}/FEE",
    "razorpay": "FX INWARD/RAZORPAY/{ref}/{payer}/FEE",
}

DEBIT_NARRATIONS = {
    "faculty": "NEFT/{ref}/{payee}/SALARY",
    "rent": "NEFT/{ref}/LANDLORD/RENT",
    "ads": "NEFT/{ref}/{payee}/ADVERTISING",
    "tax": "NEFT/{ref}/GST-PAYMENT",
    "software": "NEFT/{ref}/{payee}/SOFTWARE",
    "refund": "NEFT/{ref}/{payee}/REFUND",
    "other": "NEFT/{ref}/{payee}/MISC",
}

# Date range for generated data
DATE_START = date(2025, 4, 1)
DATE_END = date(2026, 9, 30)

# ---------------------------------------------------------------------------
# Case types for eval tagging
# ---------------------------------------------------------------------------
CASE_SIMPLE = "simple"                    # exact amount, single installment
CASE_FUZZY_NAME = "fuzzy_name"            # payer name ≠ student name
CASE_COMPANY_PAYER = "company_payer"      # company pays (may withhold TDS)
CASE_COMPANY_TDS = "company_tds"          # company withholds 10% TDS
CASE_SPLIT_PAYMENT = "split_payment"      # one payment → multiple installments
CASE_PARTIAL = "partial"                  # partial payment
CASE_DUPLICATE_AMOUNT = "duplicate_amount"  # same amount, different students
CASE_SIBLINGS = "siblings"               # same family, multiple students
CASE_GATEWAY_FEES = "gateway_fees"       # amount differs due to gateway fees
CASE_BLANK_PAYER = "blank_payer"         # no payer name
CASE_HOURLY_TOPUP = "hourly_topup"       # hourly prepay top-up


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _rand_date(rng: random.Random, start: date, end: date) -> date:
    delta = (end - start).days
    return start + timedelta(days=rng.randint(0, max(delta, 0)))


def _rand_ref(rng: random.Random) -> str:
    return "".join(rng.choices("ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789", k=12))


def _messy_date(rng: random.Random, d: date) -> str:
    """Return a date string in one of the messy formats from SPEC."""
    fmt = rng.choice(["dd/mm/yyyy", "dd.mm.yyyy", "dd.mm.yy", "d Mon"])
    if fmt == "dd/mm/yyyy":
        return d.strftime("%d/%m/%Y")
    elif fmt == "dd.mm.yyyy":
        return d.strftime("%d.%m.%Y")
    elif fmt == "dd.mm.yy":
        return d.strftime("%d.%m.%y")
    else:
        months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                  "Jul", "Aug", "Sept", "Oct", "Nov", "Dec"]
        return f"{d.day} {months[d.month - 1]}"


def _messy_amount(rng: random.Random, paise: int, currency: str) -> str:
    """Return a messy amount string mimicking SPEC section 3 patterns."""
    if currency == "INR":
        rupees = paise // 100
        variant = rng.choice(["indian_comma", "L_gst", "plain", "plus_gst"])
        if variant == "indian_comma":
            return _indian_comma_format(rupees)
        elif variant == "L_gst" and rupees >= 100000:
            lakhs = rupees / 100000
            if lakhs == int(lakhs):
                return f"{int(lakhs)}L+GST"
            return f"{lakhs:.1f}L+GST"
        elif variant == "plus_gst" and rupees >= 10000:
            # Show base + GST
            base = round(rupees * 100 / 118)
            return f"{_indian_comma_format(base)}+GST"
        else:
            return _indian_comma_format(rupees)
    return str(paise // 100)


def _indian_comma_format(n: int) -> str:
    """Format an integer with Indian comma grouping: 1,77,000."""
    s = str(abs(n))
    if len(s) <= 3:
        return s if n >= 0 else f"-{s}"
    last3 = s[-3:]
    rest = s[:-3]
    groups = []
    while rest:
        groups.append(rest[-2:])
        rest = rest[:-2]
    groups.reverse()
    result = ",".join(groups) + "," + last3
    return result if n >= 0 else f"-{result}"


def _messy_due_status(rng: random.Random) -> str:
    """Due-date column often holds statuses instead of dates (SPEC)."""
    typos = ["paid full", "Paid Full", "paid hrly", "Paid Hrly",
             "piad full", "paid hlry", "Full Paid", "PAID", "pending"]
    return rng.choice(typos)


def _messy_name(rng: random.Random, name: str) -> str:
    """Introduce name messiness: first-name only, tags, misspellings."""
    r = rng.random()
    if r < 0.07:
        # First name only
        return name.split()[0]
    elif r < 0.12:
        # Add a tag
        return name + " " + rng.choice(NAME_TAGS)
    elif r < 0.16:
        # Misspelling: swap two adjacent chars
        chars = list(name)
        if len(chars) > 3:
            i = rng.randint(1, len(chars) - 2)
            chars[i], chars[i + 1] = chars[i + 1], chars[i]
        return "".join(chars)
    return name


# ---------------------------------------------------------------------------
# Main generator
# ---------------------------------------------------------------------------

class Generator:
    def __init__(self, seed: int = 42):
        self.rng = random.Random(seed)
        self.students: list[dict] = []
        self.enrollments: list[dict] = []
        self.installments: list[dict] = []
        self.counselors: list[dict] = []
        self.payments_in: list[dict] = []
        self.payments_out: list[dict] = []
        self.bank_lines: list[dict] = []
        self.tracker_rows: list[dict] = []
        self.answers: list[dict] = []  # ground truth: payment_id → installment_ids

        self._next_student_id = 1001
        self._next_enrollment_id = 1
        self._next_installment_id = 1
        self._next_payment_in_id = 1
        self._next_payment_out_id = 1
        self._next_counselor_id = 1
        self._next_family_id = 1

        # Track sibling families: family_id → list of student_ids
        self._families: dict[int, list[int]] = {}
        # family_id → family metadata (last_name, parent_name, etc.)
        self._family_meta: dict[int, dict] = {}

    # -- ID generators --
    def _sid(self) -> int:
        v = self._next_student_id; self._next_student_id += 1; return v

    def _eid(self) -> int:
        v = self._next_enrollment_id; self._next_enrollment_id += 1; return v

    def _iid(self) -> int:
        v = self._next_installment_id; self._next_installment_id += 1; return v

    def _pid(self) -> int:
        v = self._next_payment_in_id; self._next_payment_in_id += 1; return v

    def _poid(self) -> int:
        v = self._next_payment_out_id; self._next_payment_out_id += 1; return v

    def _cid(self) -> int:
        v = self._next_counselor_id; self._next_counselor_id += 1; return v

    # ------------------------------------------------------------------
    def generate_all(self):
        self._generate_counselors(20)
        self._generate_students(200)
        self._link_city_all_counselors()
        self._generate_payments_in()
        self._generate_payments_out(60)
        self._build_tracker_csv()
        self._build_bank_statement()

    def _link_city_all_counselors(self):
        """city_all counselors get linked to ALL students in their city."""
        city_all = [c for c in self.counselors if c["type"] == "city_all"]
        if not city_all:
            return
        canon = {
            "Bengaluru": "Bangalore", "Bangalore": "Bangalore", "Blore": "Bangalore",
            "Bombay": "Mumbai", "Mumbai": "Mumbai",
            "Calcutta": "Kolkata", "Kolkata": "Kolkata",
            "Madras": "Chennai", "Chennai": "Chennai",
        }
        for c in city_all:
            c_city = canon.get(c["city"], c["city"])
            for s in self.students:
                s_city = canon.get(s.get("_raw_city", ""), s.get("_raw_city", ""))
                if s_city == c_city:
                    existing = s["counselor_ids"]
                    if c["id"] not in existing:
                        existing.append(c["id"])

    # ------------------------------------------------------------------
    # Counselors
    # ------------------------------------------------------------------
    def _generate_counselors(self, n: int):
        cities = [c for c, _ in INDIA_CITIES + OVERSEAS_CITIES]
        types_pool = []
        for t, w in COUNSELOR_TYPE_WEIGHTS:
            types_pool.extend([t] * w)
        for _ in range(n):
            cid = self._cid()
            name = f"{self.rng.choice(FIRST_NAMES)} {self.rng.choice(LAST_NAMES)}"
            ctype = self.rng.choice(types_pool)
            city = self.rng.choice(cities)
            template = self.rng.choice(COUNSELOR_TEMPLATES[ctype])
            terms = template.format(city=city)
            self.counselors.append({
                "id": cid, "name": name, "terms_text": terms,
                "city": city, "type": ctype,
            })

    # ------------------------------------------------------------------
    # Students & enrollments & installments
    # ------------------------------------------------------------------
    def _generate_students(self, n: int):
        # Pre-create families: ~12% of students are in multi-child families (2-3 kids).
        # This means ~88% are single-child families.
        # With 200 students: ~24 students in multi-child families → ~10 families of 2-3.
        multi_child_families = []
        multi_child_slots = 0
        target_multi = int(n * 0.12)  # ~24 students in multi-child families
        while multi_child_slots < target_multi:
            size = self.rng.choice([2, 2, 2, 3])  # mostly pairs, some triples
            multi_child_families.append(size)
            multi_child_slots += size

        # Build a family plan: list of family sizes
        single_count = n - multi_child_slots
        family_plan = [1] * single_count + multi_child_families
        self.rng.shuffle(family_plan)

        used_names: set[str] = set()
        used_parent_names: set[str] = set()

        for family_size in family_plan:
            # Each family gets a unique parent identity
            while True:
                last = self.rng.choice(LAST_NAMES)
                parent_first = self.rng.choice(FIRST_NAMES)
                parent_name = f"{parent_first} {last}"
                if parent_name not in used_parent_names:
                    used_parent_names.add(parent_name)
                    break

            fid = self._next_family_id
            self._next_family_id += 1

            # ~70% India, ~30% overseas (decided per family)
            if self.rng.random() < 0.70:
                city, country = self.rng.choice(INDIA_CITIES)
                is_overseas = False
            else:
                city, country = self.rng.choice(OVERSEAS_CITIES)
                is_overseas = True

            messy_city = self.rng.choice(CITY_MESS.get(city, [city]))
            messy_country = self.rng.choice(COUNTRY_MESS.get(country, [country]))
            if city == "Dubai" and self.rng.random() < 0.3:
                messy_country = "Dubai"

            # Counselor assignment — respects counselor type:
            # - "referral" / "student_referral" / "split": can refer anyone
            # - "city_referral": only refers students in their city
            # - "city_all": students are auto-linked later (all students in that city)
            counselor_ids = []
            if self.rng.random() < 0.85:
                eligible = [c for c in self.counselors if c["type"] in ("referral", "student_referral", "split")]
                eligible += [c for c in self.counselors
                             if c["type"] == "city_referral" and c["city"] == city]
                if eligible:
                    counselor_ids = [self.rng.choice(eligible)["id"]]
                    # 30% chance of a second counselor (co-referral)
                    if len(eligible) > 1 and self.rng.random() < 0.30:
                        second = self.rng.choice([c for c in eligible if c["id"] != counselor_ids[0]])
                        counselor_ids.append(second["id"])

            self._family_meta[fid] = {
                "last_name": last, "parent_name": parent_name,
                "city": city, "country": country,
                "messy_city": messy_city, "messy_country": messy_country,
                "is_overseas": is_overseas, "counselor_ids": counselor_ids,
            }
            self._families[fid] = []

            for _ in range(family_size):
                sid = self._sid()
                while True:
                    first = self.rng.choice(FIRST_NAMES)
                    name = f"{first} {last}"
                    if name not in used_names:
                        used_names.add(name)
                        break

                # Generate parent contact info
                phone_prefix = "+91 " if not is_overseas else self.rng.choice(["+971 ", "+1 ", "+44 ", "+65 "])
                phone = phone_prefix + "".join(str(self.rng.randint(0, 9)) for _ in range(10))
                email_name = parent_name.lower().replace(" ", ".").replace("'", "")
                email_domain = self.rng.choice(["gmail.com", "yahoo.com", "outlook.com", "hotmail.com"])
                email = f"{email_name}@{email_domain}"

                student = {
                    "id": sid, "name": name,
                    "aliases": [_messy_name(self.rng, name)],
                    "city": messy_city, "country": messy_country,
                    "_raw_city": city,
                    "counselor_ids": list(counselor_ids),  # copy so city_all can append
                    "parent_name": parent_name,
                    "parent_phone": phone,
                    "parent_email": email,
                    "payer_aliases": [parent_name],
                    "is_overseas": is_overseas,
                    "family_id": fid,
                }
                self.students.append(student)
                self._families[fid].append(sid)

                # Enrollments: 1-2 programs per student
                n_programs = 1 if self.rng.random() < 0.75 else 2
                for _ in range(n_programs):
                    self._generate_enrollment(student, is_overseas)

    def _generate_enrollment(self, student: dict, is_overseas: bool):
        eid = self._eid()

        # All enrollments are INR (simplified: single currency)
        currency = "INR"
        if self.rng.random() < 0.6:
            # Package
            program = self.rng.choice(PROGRAMS_PACKAGE)
            fee_model = "package"
            inclusive = self.rng.choice(COMMON_INR_PAISE)
            total_fee_paise = inclusive
            gst = not is_overseas  # overseas students exempt from GST
        else:
            # Hourly
            program = self.rng.choice(PROGRAMS_HOURLY)
            fee_model = "hourly"
            total_fee_paise = self.rng.choice([4130000, 5900000, 11800000])
            gst = not is_overseas

        enrollment = {
            "id": eid, "student_id": student["id"],
            "program": program, "fee_model": fee_model,
            "total_fee_paise": total_fee_paise, "currency": currency,
            "gst_applicable": gst,
        }
        self.enrollments.append(enrollment)

        # Create installments — spread across the full date range
        # Each enrollment gets a random start point within the range
        range_days = (DATE_END - DATE_START).days
        enroll_start = _rand_date(self.rng, DATE_START, DATE_START + timedelta(days=range_days - 120))

        if fee_model == "package":
            if self.rng.random() < 0.4:
                # Two installments
                half = total_fee_paise // 2
                due1 = enroll_start + timedelta(days=self.rng.randint(0, 30))
                due2 = due1 + timedelta(days=self.rng.randint(45, 75))
                self.installments.append({
                    "id": self._iid(), "enrollment_id": eid,
                    "due_date": due1.isoformat(),
                    "amount_due_paise": half, "currency": currency,
                    "status": "open",
                })
                self.installments.append({
                    "id": self._iid(), "enrollment_id": eid,
                    "due_date": due2.isoformat(),
                    "amount_due_paise": total_fee_paise - half, "currency": currency,
                    "status": "open",
                })
            else:
                # Single installment
                due = enroll_start + timedelta(days=self.rng.randint(0, 45))
                self.installments.append({
                    "id": self._iid(), "enrollment_id": eid,
                    "due_date": due.isoformat(),
                    "amount_due_paise": total_fee_paise, "currency": currency,
                    "status": "open",
                })
        else:
            # Hourly: 1-3 top-up installments
            n_topups = self.rng.randint(1, 3)
            for j in range(n_topups):
                due = enroll_start + timedelta(days=self.rng.randint(30 * j, 30 * (j + 2)))
                self.installments.append({
                    "id": self._iid(), "enrollment_id": eid,
                    "due_date": due.isoformat(),
                    "amount_due_paise": total_fee_paise, "currency": currency,
                    "status": "open",
                })

    # ------------------------------------------------------------------
    # Payments in (with answer keys)
    # ------------------------------------------------------------------
    def _generate_payments_in(self):
        """Generate ~400 incoming payments matched to installments."""
        # Build installment lookup
        inst_by_id = {i["id"]: i for i in self.installments}
        enroll_by_id = {e["id"]: e for e in self.enrollments}
        student_by_id = {s["id"]: s for s in self.students}

        # Collect installments to pay
        payable = list(self.installments)
        self.rng.shuffle(payable)

        paid_installments: set[int] = set()
        target_payments = 400

        while len(self.payments_in) < target_payments and payable:
            inst = payable.pop()
            if inst["id"] in paid_installments:
                continue

            enroll = enroll_by_id[inst["enrollment_id"]]
            student = student_by_id[enroll["student_id"]]

            # Decide case type and generate payment
            case_types = []
            is_overseas = student["is_overseas"]
            currency = inst["currency"]

            # Pick payment method
            method = self._pick_method()

            # Decide payer
            payer_name, payer_type = self._pick_payer(student, method)
            if payer_name is None:
                case_types.append(CASE_BLANK_PAYER)
            elif payer_type == "company":
                case_types.append(CASE_COMPANY_PAYER)
            elif payer_type == "parent":
                case_types.append(CASE_FUZZY_NAME)

            if enroll["fee_model"] == "hourly":
                case_types.append(CASE_HOURLY_TOPUP)

            # Check for duplicate amount (same amount exists already)
            if any(p["amount_paid_paise"] == inst["amount_due_paise"]
                   and p["currency"] == currency
                   for p in self.payments_in):
                case_types.append(CASE_DUPLICATE_AMOUNT)

            # Check siblings — only tag if family has multiple children
            fid = student["family_id"]
            if len(self._families.get(fid, [])) > 1:
                case_types.append(CASE_SIBLINGS)

            # Company TDS: ~6% of company payers withhold 10% TDS
            payer_tds_paise = 0
            if payer_type == "company" and self.rng.random() < 0.5:
                # They send 108% of base instead of 118% (withhold 10% TDS)
                case_types.append(CASE_COMPANY_TDS)
                # The base amount (pre-GST)
                if enroll["gst_applicable"]:
                    from ledger.money import remove_gst
                    base = remove_gst(inst["amount_due_paise"])
                    payer_tds_paise = round(base * 0.10)
                    amount_sent = inst["amount_due_paise"] - payer_tds_paise
                else:
                    payer_tds_paise = round(inst["amount_due_paise"] * 0.10)
                    amount_sent = inst["amount_due_paise"] - payer_tds_paise
            else:
                amount_sent = inst["amount_due_paise"]

            # Possibly split payment across siblings
            allocations = [{"installment_id": inst["id"], "allocated_paise": amount_sent}]
            paid_installments.add(inst["id"])

            if (self.rng.random() < 0.08 and payable
                    and CASE_SIBLINGS in case_types):
                # Pay for a sibling too
                sibling_inst = None
                for idx, pi in enumerate(payable):
                    ei = enroll_by_id[pi["enrollment_id"]]
                    si = student_by_id[ei["student_id"]]
                    if si["family_id"] == fid and pi["id"] not in paid_installments:
                        sibling_inst = payable.pop(idx)
                        break
                if sibling_inst:
                    sib_amount = sibling_inst["amount_due_paise"]
                    amount_sent += sib_amount
                    allocations.append({
                        "installment_id": sibling_inst["id"],
                        "allocated_paise": sib_amount,
                    })
                    paid_installments.add(sibling_inst["id"])
                    case_types.append(CASE_SPLIT_PAYMENT)

            # Partial payment (~5%)
            if self.rng.random() < 0.05 and len(allocations) == 1:
                fraction = self.rng.choice([0.5, 0.6, 0.75])
                amount_sent = round(amount_sent * fraction)
                allocations[0]["allocated_paise"] = amount_sent
                case_types.append(CASE_PARTIAL)
            # Note: installment status stays "open" — status is only derived
            # from approved matches, never set by the generator (no leakage).

            # Gateway fees
            gateway_fee_paise = 0
            gst_on_fee_paise = 0
            amount_in_bank = amount_sent
            gw_key = METHOD_TO_GATEWAY_KEY.get(method)

            if gw_key:
                case_types.append(CASE_GATEWAY_FEES)
                fee, gst_fee, total_ded = gateway_fee_with_gst(
                    amount_sent, gw_key,
                )
                gateway_fee_paise = fee
                gst_on_fee_paise = gst_fee
                amount_in_bank = amount_sent - total_ded

            amount_in_bank_inr = amount_in_bank

            # Simple case: no special complexity
            if not case_types:
                case_types.append(CASE_SIMPLE)

            pay_date = _rand_date(self.rng, DATE_START, DATE_END)

            # Source & confirmation
            if method in ("stripe", "payglocal", "razorpay"):
                source = "gateway"
                confirmation = "seen_by_gateway" if self.rng.random() < 0.7 else "in_bank"
            elif method == "cash":
                source = "cash"
                confirmation = "screenshot_only"
            elif method == "blank":
                source = "screenshot"
                confirmation = "screenshot_only"
                method = None  # will be blank in output
            else:
                source = "bank"
                confirmation = "in_bank" if self.rng.random() < 0.8 else "screenshot_only"

            pid = self._pid()
            payment = {
                "id": pid,
                "source": source,
                "method": method,
                "payer_name": payer_name,
                "date": pay_date.isoformat(),
                "amount_paid_paise": amount_sent,
                "currency": currency,
                "gateway_fee_paise": gateway_fee_paise,
                "gst_on_fee_paise": gst_on_fee_paise,
                "tds_paise": payer_tds_paise,
                "fx_diff_paise": 0,
                "amount_in_bank_paise": amount_in_bank_inr,
                "confirmation": confirmation,
                "case_types": sorted(set(case_types)),
            }
            self.payments_in.append(payment)

            self.answers.append({
                "payment_id": pid,
                "installment_ids": [a["installment_id"] for a in allocations],
                "allocations": allocations,
                "case_types": sorted(set(case_types)),
            })

        # Fill up remaining with unmatched payments (noise ~5%)
        n_noise = max(0, target_payments - len(self.payments_in))
        for _ in range(min(n_noise, 20)):
            pid = self._pid()
            method = self._pick_method()
            amt = self.rng.choice(COMMON_INR_PAISE)

            pay_date = _rand_date(self.rng, DATE_START, DATE_END)
            if method == "blank":
                method = None
            self.payments_in.append({
                "id": pid, "source": "bank",
                "method": method,
                "payer_name": f"{self.rng.choice(FIRST_NAMES)} {self.rng.choice(LAST_NAMES)}",
                "date": pay_date.isoformat(),
                "amount_paid_paise": amt, "currency": "INR",
                "gateway_fee_paise": 0, "gst_on_fee_paise": 0,
                "tds_paise": 0, "fx_diff_paise": 0,
                "amount_in_bank_paise": amt,
                "confirmation": "in_bank",
                "case_types": ["noise"],
            })
            # No answer for noise payments

    def _pick_method(self) -> str:
        methods = list(METHOD_WEIGHTS.keys())
        weights = list(METHOD_WEIGHTS.values())
        return self.rng.choices(methods, weights=weights, k=1)[0]

    def _pick_payer(self, student: dict, method: str | None) -> tuple[str | None, str]:
        """Return (payer_name, payer_type). payer_name may be None (~50%)."""
        # ~50% blank
        if self.rng.random() < 0.50:
            return None, "blank"
        # ~6% company
        if self.rng.random() < 0.06:
            return self.rng.choice(COMPANY_NAMES), "company"
        # ~2% student themselves
        if self.rng.random() < 0.04:
            return student["name"], "student"
        # Rest: parent
        return student["parent_name"], "parent"

    # ------------------------------------------------------------------
    # Payments out
    # ------------------------------------------------------------------
    def _generate_payments_out(self, n: int):
        cats = [c for c, _ in PAYMENT_OUT_CATEGORIES]
        cat_weights = [w for _, w in PAYMENT_OUT_CATEGORIES]

        payee_names = {
            "faculty": ["Prof. Anil Kumar", "Dr. Sunita Rao", "Prof. Vikram Iyer",
                       "Dr. Meena Pillai", "Prof. Rajesh Nair"],
            "rent": ["Greenfield Properties", "Metro Realty"],
            "ads": ["Google Ads", "Meta Ads", "LinkedIn Marketing"],
            "tax": ["GST Authority"],
            "software": ["Zoom Video", "Google Workspace", "AWS"],
            "refund": [],  # will use student names
            "other": ["Office Supplies Co", "Travel Agency"],
        }

        for _ in range(n):
            cat = self.rng.choices(cats, weights=cat_weights, k=1)[0]
            poid = self._poid()
            pay_date = _rand_date(self.rng, DATE_START, DATE_END)

            if cat == "refund" and self.students:
                payee = self.rng.choice(self.students)["parent_name"]
            else:
                pool = payee_names.get(cat, ["Misc Vendor"])
                payee = self.rng.choice(pool) if pool else "Misc Vendor"

            # Random amount in INR
            amount = self.rng.randint(500000, 15000000)  # ₹5,000 – ₹1,50,000

            self.payments_out.append({
                "id": poid, "date": pay_date.isoformat(),
                "payee": payee, "category": cat,
                "amount_paise": amount, "currency": "INR",
            })

    # ------------------------------------------------------------------
    # Messy tracker CSV (SPEC section 3 patterns)
    # ------------------------------------------------------------------
    def _build_tracker_csv(self):
        enroll_by_id = {e["id"]: e for e in self.enrollments}
        student_by_id = {s["id"]: s for s in self.students}
        answer_by_pid = {a["payment_id"]: a for a in self.answers}

        for pay in self.payments_in:
            pid = pay["id"]
            ans = answer_by_pid.get(pid)

            if ans:
                first_inst_id = ans["installment_ids"][0]
                inst = next(i for i in self.installments if i["id"] == first_inst_id)
                enroll = enroll_by_id[inst["enrollment_id"]]
                student = student_by_id[enroll["student_id"]]
                student_name = _messy_name(self.rng, student["name"])
                program = enroll["program"]
            else:
                student_name = pay.get("payer_name", "Unknown")
                program = ""

            # Messy date
            pay_date = date.fromisoformat(pay["date"])
            messy_dt = _messy_date(self.rng, pay_date)

            # Messy amount
            messy_amt = _messy_amount(
                self.rng, pay["amount_paid_paise"], pay["currency"],
            )

            # Due date column: mostly statuses, sometimes actual dates
            if self.rng.random() < 0.6:
                due_col = _messy_due_status(self.rng)
            elif ans:
                due_date = date.fromisoformat(inst["due_date"])
                due_col = _messy_date(self.rng, due_date)
            else:
                due_col = ""

            # Method
            method_str = pay["method"] if pay["method"] else ""
            if method_str and self.rng.random() < 0.05:
                method_str = method_str.upper()

            # Sibling duplication: copy row for each sibling enrollment
            n_copies = 1
            if ans and CASE_SIBLINGS in ans["case_types"] and self.rng.random() < 0.3:
                n_copies = len(ans["installment_ids"])

            for copy_idx in range(n_copies):
                row = {
                    "payment_id": pid,
                    "student_name": student_name,
                    "program": program,
                    "date": messy_dt,
                    "amount": messy_amt,
                    "method": method_str,
                    "payer": pay["payer_name"] or "",
                    "due_date": due_col,
                    "notes": "",
                }
                # Sometimes put status in amount column (SPEC)
                if self.rng.random() < 0.03:
                    row["amount"] = "Paid Full"

                self.tracker_rows.append(row)

    # ------------------------------------------------------------------
    # Bank statement
    # ------------------------------------------------------------------
    def _build_bank_statement(self):
        # Credits (payments in)
        for pay in self.payments_in:
            if pay["amount_in_bank_paise"] <= 0:
                continue
            method = pay["method"] or "neft"
            template = NARRATION_TEMPLATES.get(method, NARRATION_TEMPLATES["neft"])
            payer = (pay["payer_name"] or "UNKNOWN").upper()
            narration = template.format(ref=_rand_ref(self.rng), payer=payer)

            # Bank date: 0-5 days after payment date for gateway
            pay_date = date.fromisoformat(pay["date"])
            if pay["source"] == "gateway":
                bank_date = pay_date + timedelta(days=self.rng.randint(1, 5))
            else:
                bank_date = pay_date

            self.bank_lines.append({
                "date": bank_date.isoformat(),
                "narration": narration,
                "credit_paise": pay["amount_in_bank_paise"],
                "debit_paise": 0,
                "payment_id": pay["id"],
            })

        # Debits (payments out)
        for pay in self.payments_out:
            cat = pay["category"]
            template = DEBIT_NARRATIONS.get(cat, DEBIT_NARRATIONS["other"])
            narration = template.format(
                ref=_rand_ref(self.rng),
                payee=pay["payee"].upper(),
            )
            self.bank_lines.append({
                "date": pay["date"],
                "narration": narration,
                "credit_paise": 0,
                "debit_paise": pay["amount_paise"],
                "payment_id": None,
            })

        # Sort by date
        self.bank_lines.sort(key=lambda x: x["date"])

    # ------------------------------------------------------------------
    # Write outputs
    # ------------------------------------------------------------------
    def write_all(self, out_dir: Path):
        out_dir.mkdir(parents=True, exist_ok=True)

        # Students CSV
        self._write_csv(out_dir / "students.csv", self.students, [
            "id", "name", "aliases", "city", "country", "counselor_ids",
            "payer_aliases", "parent_name", "parent_phone", "parent_email",
        ])

        # Enrollments CSV
        self._write_csv(out_dir / "enrollments.csv", self.enrollments, [
            "id", "student_id", "program", "fee_model",
            "total_fee_paise", "currency", "gst_applicable",
        ])

        # Installments CSV
        self._write_csv(out_dir / "installments.csv", self.installments, [
            "id", "enrollment_id", "due_date", "amount_due_paise",
            "currency", "status",
        ])

        # Counselors CSV
        self._write_csv(out_dir / "counselors.csv", self.counselors, [
            "id", "name", "terms_text", "city",
        ])

        # Payments in CSV (clean — the "ledger" truth)
        self._write_csv(out_dir / "payments_in.csv", self.payments_in, [
            "id", "source", "method", "payer_name", "date",
            "amount_paid_paise", "currency",
            "gateway_fee_paise", "gst_on_fee_paise", "tds_paise",
            "fx_diff_paise", "amount_in_bank_paise", "confirmation",
        ])

        # Payments out CSV
        self._write_csv(out_dir / "payments_out.csv", self.payments_out, [
            "id", "date", "payee", "category", "amount_paise", "currency",
        ])

        # Messy tracker CSV
        self._write_csv(out_dir / "tracker.csv", self.tracker_rows, [
            "payment_id", "student_name", "program", "date", "amount",
            "method", "payer", "due_date", "notes",
        ])

        # Bank statement CSV
        self._write_csv(out_dir / "bank_statement.csv", self.bank_lines, [
            "date", "narration", "credit_paise", "debit_paise",
        ])

        # Answers JSON
        with open(out_dir / "answers.json", "w") as f:
            json.dump(self.answers, f, indent=2)

        # Dev / test split (70/30)
        self.rng.shuffle(self.answers)
        split_idx = int(len(self.answers) * 0.70)
        dev_answers = self.answers[:split_idx]
        test_answers = self.answers[split_idx:]

        dev_dir = out_dir / "dev"
        test_dir = out_dir / "test"
        dev_dir.mkdir(exist_ok=True)
        test_dir.mkdir(exist_ok=True)

        dev_ids = {a["payment_id"] for a in dev_answers}
        test_ids = {a["payment_id"] for a in test_answers}

        with open(dev_dir / "answers.json", "w") as f:
            json.dump(dev_answers, f, indent=2)
        with open(test_dir / "answers.json", "w") as f:
            json.dump(test_answers, f, indent=2)

        # Split payments_in too
        dev_payments = [p for p in self.payments_in if p["id"] in dev_ids]
        test_payments = [p for p in self.payments_in if p["id"] in test_ids]
        noise_payments = [p for p in self.payments_in
                         if p["id"] not in dev_ids and p["id"] not in test_ids]
        # Add noise to dev
        dev_payments.extend(noise_payments)

        self._write_csv(dev_dir / "payments_in.csv", dev_payments, [
            "id", "source", "method", "payer_name", "date",
            "amount_paid_paise", "currency",
            "gateway_fee_paise", "gst_on_fee_paise", "tds_paise",
            "fx_diff_paise", "amount_in_bank_paise", "confirmation",
        ])
        self._write_csv(test_dir / "payments_in.csv", test_payments, [
            "id", "source", "method", "payer_name", "date",
            "amount_paid_paise", "currency",
            "gateway_fee_paise", "gst_on_fee_paise", "tds_paise",
            "fx_diff_paise", "amount_in_bank_paise", "confirmation",
        ])

    def _write_csv(self, path: Path, rows: list[dict], columns: list[str]):
        with open(path, "w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=columns, extrasaction="ignore")
            writer.writeheader()
            for row in rows:
                # Stringify list fields
                out = {}
                for col in columns:
                    val = row.get(col, "")
                    if isinstance(val, list):
                        val = json.dumps(val)
                    out[col] = val
                writer.writerow(out)

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    def print_summary(self):
        print(f"\n{'='*60}")
        print("Educore Finance Desk — Generated Data Summary")
        print(f"{'='*60}")
        print(f"Students:        {len(self.students)}")
        print(f"Enrollments:     {len(self.enrollments)}")
        print(f"Installments:    {len(self.installments)}")
        print(f"Counselors:      {len(self.counselors)}")
        print(f"Payments in:     {len(self.payments_in)}")
        print(f"Payments out:    {len(self.payments_out)}")
        print(f"Bank lines:      {len(self.bank_lines)}")
        print(f"Tracker rows:    {len(self.tracker_rows)}")
        print(f"Answer keys:     {len(self.answers)}")

        # Dev/test split
        split_idx = int(len(self.answers) * 0.70)
        print(f"  Dev split:     {split_idx}")
        print(f"  Test split:    {len(self.answers) - split_idx}")

        # Case type counts
        case_counter: Counter[str] = Counter()
        for ans in self.answers:
            for ct in ans["case_types"]:
                case_counter[ct] += 1

        print(f"\nCase type distribution:")
        print(f"{'Case Type':<25} {'Count':>6}")
        print(f"{'-'*25} {'-'*6}")
        for case_type, count in case_counter.most_common():
            print(f"{case_type:<25} {count:>6}")
        print()


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(description="Generate fake Educore data")
    parser.add_argument("--seed", type=int, default=42, help="Random seed")
    parser.add_argument("--out", type=str, default=None,
                       help="Output directory (default: data/)")
    args = parser.parse_args()

    out_dir = Path(args.out) if args.out else Path(__file__).resolve().parent

    gen = Generator(seed=args.seed)
    gen.generate_all()
    gen.write_all(out_dir)
    gen.print_summary()

    print(f"Data written to {out_dir}")


if __name__ == "__main__":
    main()
