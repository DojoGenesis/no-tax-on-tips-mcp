/**
 * OBBBA No-Tax-on-Tips Deduction — Reference Data (versioned)
 *
 * Versioned constant set per ADR 030. When IRS issues revised guidance,
 * update module_version + constants; cached deduction results invalidate
 * automatically (callers compare module_version to detect staleness).
 *
 * CORRECTED 2026-05-19 against IRS final regs published 2026-04-13
 * (Federal Register 2026-07104).
 *
 * Cross-refs:
 *   decisions/030-no-tax-on-tips-federal-deduction.md §Reference data versioning
 *   decisions/013-state-tax-rate-handling.md §Annual rate refresh (mirrors pattern)
 */

export type FilingStatus =
  | 'single'
  | 'head_of_household'
  | 'married_filing_jointly'
  | 'married_filing_separately';

export const OBBBA_REFERENCE_DATA = {
  module_version: "1.0.0-2026-04-13",           // matches IRS final regs date (Fed Reg 2026-07104)
  sunset_start_utc: 1735689600,                  // 2025-01-01T00:00:00Z
  sunset_end_utc:   1798761599,                  // 2028-12-31T23:59:59Z

  // 2025 transition relief: separate-reporting requirement waived for 2025 tax year.
  // 2026+ tax years require separate reporting on W-2 / 1099-NEC / 1099-MISC / 1099-K / Form 4137.
  transition_relief_through_tax_year: 2025,

  // Per-filing-status cap (qualified tip income allowed as deduction, before phase-out)
  cap_cents_by_filing_status: {
    single:                    2_500_000,   // $25,000
    head_of_household:         2_500_000,   // $25,000
    married_filing_jointly:    2_500_000,   // $25,000 (per individual, not pooled)
    married_filing_separately: 1_250_000,   // $12,500
  } as Record<FilingStatus, number>,

  // Phase-out: linear, $100 reduction per $1,000 (or fraction thereof) MAGI over threshold.
  // Single full phase-out at $400K = $150K threshold + ($25K cap ÷ $100/$1K = $250K range).
  // Joint full phase-out at $550K = $300K threshold + $250K range.
  // MFS full phase-out at $275K = $150K threshold + $125K range (halved $12.5K cap).
  phase_out_by_filing_status: {
    single: {
      threshold_cents: 15_000_000,  // $150,000
      full_cents:      40_000_000,  // $400,000
    },
    head_of_household: {
      threshold_cents: 15_000_000,  // $150,000 (treated as single)
      full_cents:      40_000_000,  // $400,000
    },
    married_filing_jointly: {
      threshold_cents: 30_000_000,  // $300,000
      full_cents:      55_000_000,  // $550,000
    },
    married_filing_separately: {
      threshold_cents: 15_000_000,  // $150,000
      full_cents:      27_500_000,  // $275,000 ($150K + $125K range for halved $12.5K cap)
    },
  } as Record<FilingStatus, { threshold_cents: number; full_cents: number }>,

  // $100 reduction per $1,000 MAGI over threshold
  reduction_per_1000_magi_cents: 10_000,  // 10_000 cents = $100

  // TTOC (Treasury Tipped Occupation Code) reference — descriptive slug codes for V2.0.
  // Full list at IRS.gov/TippedOccupations (~70+ occupations across 8 categories).
  // NS V2 onboarding maps user-selected role to a TTOC code; this JSON is the authoritative
  // server-side validation set.
  // Annual refresh gate catches updates (e.g., April 2026 final regs added visual artists,
  // floral designers, gas pump attendants).
  ttoc_codes_eligible_path: "data/ttoc-codes-2026-04-13.json",  // separate JSON file; not inlined

  // Onboarding picker subset — most common NS V2 occupations (12-occupation curated list
  // per scout 2026-05-19 Q30.3). "other_tipped_ttoc_lookup" opens a TTOC search modal.
  onboarding_picker_subset: [
    "wait_staff",
    "bartender_barback",
    "host_busser_runner",
    "rideshare_driver",
    "delivery_driver",
    "taxi_driver",
    "valet_parking",
    "hairstylist_barber",
    "nail_technician",
    "massage_therapist",
    "hotel_concierge_bellhop",
    "other_tipped_ttoc_lookup",
  ],

  reference_pub_url: "https://www.irs.gov/TippedOccupations",
  final_regs_federal_register_url:
    "https://www.federalregister.gov/documents/2026/04/13/2026-07104/occupations-that-customarily-and-regularly-received-tips-definition-of-qualified-tips",

  // Set on operator signoff per ADR 013 annual review pattern. 0 = not yet reviewed.
  reviewed_by_operator_at_utc: 0,
} as const;
