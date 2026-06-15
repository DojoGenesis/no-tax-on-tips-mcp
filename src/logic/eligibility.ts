/**
 * OBBBA No-Tax-on-Tips Deduction — Eligibility checks
 *
 * Exports:
 *   checkSunsetWindow(tax_year)      — true if 2025-2028 inclusive
 *   checkTransitionRelief(tax_year)  — true if tax_year ≤ 2025
 *   isTTOCEligible(ttoc_code)        — true if code is in the V2.0 TTOC set
 *   computePhaseOutFraction(magi_cents, filing_status) — 0 to 1 linear
 *
 * Workers-compatible — no Node-only APIs.
 *
 * Cross-refs:
 *   decisions/030-no-tax-on-tips-federal-deduction.md §Eligibility detection (V2.0)
 *   decisions/030-no-tax-on-tips-federal-deduction.md §Integration gate items 2-4
 */

import { OBBBA_REFERENCE_DATA, type FilingStatus } from './reference-data.js';

// ---------------------------------------------------------------------------
// TTOC code set (loaded from JSON at module initialisation)
// ---------------------------------------------------------------------------
import ttocData from './data/ttoc-codes-2026-04-13.json' with { type: 'json' };

const TTOC_ELIGIBLE_SET: ReadonlySet<string> = new Set(
  (ttocData as { all_codes: string[] }).all_codes,
);

// ---------------------------------------------------------------------------
// Sunset window check
// ---------------------------------------------------------------------------

/**
 * Returns true if the given tax year falls within the OBBBA sunset window
 * (2025-2028 inclusive per statute).
 *
 * The check uses the reference-data UTC epoch boundaries but expresses the
 * test as a simple integer year comparison for clarity and testability.
 * The epoch sentinels are the canonical source of truth; the year range
 * 2025-2028 is the human-readable interpretation.
 */
export function checkSunsetWindow(tax_year: number): boolean {
  // sunset_start_utc = 2025-01-01T00:00:00Z → tax year 2025
  // sunset_end_utc   = 2028-12-31T23:59:59Z → tax year 2028
  return tax_year >= 2025 && tax_year <= 2028;
}

// ---------------------------------------------------------------------------
// Transition relief check
// ---------------------------------------------------------------------------

/**
 * Returns true if the given tax year qualifies for OBBBA transition relief.
 * For 2025, the separate-reporting requirement (W-2 / 1099 tip fields) is
 * waived — tip income that was not separately reported by the employer can
 * still qualify. 2026+ requires separate reporting per final regs.
 */
export function checkTransitionRelief(tax_year: number): boolean {
  return tax_year <= OBBBA_REFERENCE_DATA.transition_relief_through_tax_year;
}

// ---------------------------------------------------------------------------
// TTOC eligibility check
// ---------------------------------------------------------------------------

/**
 * Returns true if the given TTOC code appears in the V2.0 eligible set.
 *
 * Note: real Treasury TTOC codes are 3-digit numeric per IRS final regs
 * (Fed Reg 2026-07104). The V2.0 set uses descriptive slugs as placeholders
 * until the operator validation pass replaces them with numeric codes.
 *
 * @param ttoc_code - occupation code from user's onboarding picker or TTOC search
 */
export function isTTOCEligible(ttoc_code: string): boolean {
  return TTOC_ELIGIBLE_SET.has(ttoc_code);
}

// ---------------------------------------------------------------------------
// Phase-out fraction computation
// ---------------------------------------------------------------------------

/**
 * Computes the phase-out fraction for the OBBBA deduction.
 *
 * Returns:
 *   0.0   — MAGI at or below the phase-out threshold (full deduction)
 *   1.0   — MAGI at or above the full phase-out amount (zero deduction)
 *   (0,1) — linear interpolation between threshold and full phase-out
 *
 * The IRS specifies $100 reduction per $1,000 (or fraction thereof) of MAGI
 * above the threshold, which is mathematically equivalent to a linear
 * interpolation over the (threshold → full_cents) range. This implementation
 * uses exact linear interpolation (continuous); operator confirmed as linear
 * per scout 2026-05-19 Q30.2 resolution.
 *
 * All amounts are integer cents. Result is a float in [0, 1].
 *
 * @param magi_cents    - Modified Adjusted Gross Income in minor units (cents)
 * @param filing_status - drives which threshold/full_cents bracket to use
 */
export function computePhaseOutFraction(
  magi_cents: number,
  filing_status: FilingStatus,
): number {
  const band = OBBBA_REFERENCE_DATA.phase_out_by_filing_status[filing_status];
  const { threshold_cents, full_cents } = band;

  if (magi_cents <= threshold_cents) return 0;
  if (magi_cents >= full_cents) return 1;

  // Linear interpolation: how far through the phase-out range are we?
  const numerator = magi_cents - threshold_cents;
  const denominator = full_cents - threshold_cents;
  return numerator / denominator;
}
