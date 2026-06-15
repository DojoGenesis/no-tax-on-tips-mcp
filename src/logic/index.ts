/**
 * OBBBA No-Tax-on-Tips Deduction Module — Public Surface
 *
 * One Big Beautiful Bill Act (OBBBA) §§ establishing a federal income-tax
 * deduction for qualified tip income. Active tax years 2025-2028 (sunset module).
 *
 * Entry point: applyDeduction(input: OBBBADeductionInput): OBBBADeductionResult
 *
 * This module is SELF-CONTAINED. It does NOT integrate with estimator.ts or
 * schedule-c.ts — that wiring is a follow-up integration task for the main thread
 * per ADR 030 integration gate items 7-9.
 *
 * Application points (future integration by main thread):
 *   1. quarterly-estimate.ts — subtract deduction_amount_cents from federal income-tax
 *      base before rate table application (SE tax line unchanged; tips still FICA-subject)
 *   2. schedule-c-summary.ts — Part I addendum line showing OBBBA deduction
 *   3. Insights tab tax-reserve — post-deduction federal estimate per ADR 014
 *
 * // TODO operator-validate: replace descriptive TTOC slugs in
 * //   data/ttoc-codes-2026-04-13.json with numeric TTOC codes from IRS.gov/TippedOccupations
 * //   once the operator validation pass against final regs runs. Real Treasury TTOC codes
 * //   are 3-digit numeric per IRS final regs (Fed Reg 2026-07104).
 *
 * Workers-compatible — no Node-only APIs. No new dependencies.
 *
 * Cross-refs:
 *   decisions/030-no-tax-on-tips-federal-deduction.md (spec — read in full before editing)
 *   decisions/013-state-tax-rate-handling.md (pattern this ADR mirrors)
 *   docs/product/core-offerings.md (Tier-2 liability boundary)
 *   src/i18n/locales/en-US/tax.json §obbba (i18n keys for all user-facing strings)
 */

import { OBBBA_REFERENCE_DATA, type FilingStatus } from './reference-data.js';
import {
  checkSunsetWindow,
  checkTransitionRelief,
  isTTOCEligible,
  computePhaseOutFraction,
} from './eligibility.js';
import {
  computeQualifiedTipIncome,
  computeDeductionAmount,
} from './computation.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Tip breakdown per ADR 029 schema. All values are integer cents (≥ 0). */
export interface TipBreakdown {
  tip_cash: number;
  tip_credit: number;
  tip_out: number;
  tip_in: number;
}

/** Input to applyDeduction(). All monetary values are integer cents. */
export interface OBBBADeductionInput {
  /** Gross income for the period (cents) — used for context; deduction math uses tip fields */
  gross_income_cents: number;
  /** Tip breakdown per ADR 029 schema */
  tip_breakdown: TipBreakdown;
  /** Modified Adjusted Gross Income (cents) — drives phase-out calculation */
  magi_cents: number;
  /** Filing status — drives cap and phase-out thresholds */
  filing_status: FilingStatus;
  /**
   * Treasury Tipped Occupation Code from IRS-published list.
   * NS V2 onboarding maps user's selected role to a TTOC code.
   * Non-TTOC codes yield qualifies=false.
   */
  ttoc_code: string;
  /** Tax year (integer, e.g. 2026) */
  tax_year: number;
}

/** Result from applyDeduction(). All monetary values are integer cents. */
export interface OBBBADeductionResult {
  /** false when: outside 2025-2028 window, non-TTOC occupation, or MAGI fully phased out */
  qualifies: boolean;
  /** Net qualified tip income after tip-out reduction, capped at statutory limit */
  qualified_tip_income_cents: number;
  /** Final deduction: qualified tips × (1 - phase_out_fraction), bounded by cap */
  deduction_amount_cents: number;
  /** 0 below phase-out threshold, linearly increases to 1 at full phase-out */
  phase_out_fraction: number;
  /** Echo of filing_status input for audit trail */
  filing_status_applied: string;
  /** Echo of ttoc_code input for audit trail */
  ttoc_code_applied: string;
  /**
   * Human-readable reason when deduction_amount_cents === 0.
   * Empty string when deduction is non-zero.
   */
  reason_if_zero: string;
  /** Unix epoch seconds UTC when the deduction was computed */
  computed_at_utc: number;
  /**
   * Module version string matching IRS final regs date.
   * Invalidates cached results when IRS guidance updates.
   */
  module_version: string;
  /**
   * True for 2025 tax year — caller should display transition-relief note in UI.
   * i18n key: "tax.obbba.transition-relief-note"
   */
  transition_relief_applies: boolean;
}

// Re-export types for external consumers
export type { FilingStatus } from './reference-data.js';
export { OBBBA_REFERENCE_DATA } from './reference-data.js';
export {
  checkSunsetWindow,
  checkTransitionRelief,
  isTTOCEligible,
  computePhaseOutFraction,
} from './eligibility.js';
export {
  computeQualifiedTipIncome,
  computeDeductionAmount,
} from './computation.js';

// ---------------------------------------------------------------------------
// Reason constants — referenced by integration tests + UI i18n surface
// ---------------------------------------------------------------------------

export const REASON_OUTSIDE_WINDOW = 'Outside 2025-2028 sunset window';
export const REASON_NOT_TTOC = 'Occupation not on TTOC list';
export const REASON_PHASED_OUT = 'MAGI fully phased out';
export const REASON_ZERO_TIPS = 'No qualified tip income';

// ---------------------------------------------------------------------------
// applyDeduction — main entry point
// ---------------------------------------------------------------------------

/**
 * Applies the OBBBA No-Tax-on-Tips deduction to the given input.
 *
 * Evaluation order:
 *   1. Sunset window check (tax year 2025-2028)
 *   2. TTOC eligibility check (occupation on IRS list)
 *   3. Qualified tip income computation (net of tip-out, floored at 0)
 *   4. Phase-out fraction computation (MAGI-based, filing-status-aware)
 *   5. Cap application + deduction amount (min(qualified, cap) × (1 - phase_out))
 *
 * Returns a fully-populated OBBBADeductionResult regardless of eligibility.
 * When qualifies=false, deduction_amount_cents is always 0 and reason_if_zero
 * is populated.
 *
 * All monetary values are integer cents. Datetime is integer unix epoch UTC.
 */
export function applyDeduction(input: OBBBADeductionInput): OBBBADeductionResult {
  const {
    tip_breakdown,
    magi_cents,
    filing_status,
    ttoc_code,
    tax_year,
  } = input;

  const computed_at_utc = Math.floor(Date.now() / 1000);
  const transition_relief_applies = checkSunsetWindow(tax_year) && checkTransitionRelief(tax_year);

  // ── 1. Sunset window ───────────────────────────────────────────────────────
  if (!checkSunsetWindow(tax_year)) {
    return {
      qualifies: false,
      qualified_tip_income_cents: 0,
      deduction_amount_cents: 0,
      phase_out_fraction: 0,
      filing_status_applied: filing_status,
      ttoc_code_applied: ttoc_code,
      reason_if_zero: REASON_OUTSIDE_WINDOW,
      computed_at_utc,
      module_version: OBBBA_REFERENCE_DATA.module_version,
      transition_relief_applies,
    };
  }

  // ── 2. TTOC occupation eligibility ─────────────────────────────────────────
  if (!isTTOCEligible(ttoc_code)) {
    return {
      qualifies: false,
      qualified_tip_income_cents: 0,
      deduction_amount_cents: 0,
      phase_out_fraction: 0,
      filing_status_applied: filing_status,
      ttoc_code_applied: ttoc_code,
      reason_if_zero: REASON_NOT_TTOC,
      computed_at_utc,
      module_version: OBBBA_REFERENCE_DATA.module_version,
      transition_relief_applies,
    };
  }

  // ── 3. Qualified tip income ────────────────────────────────────────────────
  const qualified_tip_income_cents = computeQualifiedTipIncome(
    tip_breakdown.tip_cash,
    tip_breakdown.tip_credit,
    tip_breakdown.tip_out,
    tip_breakdown.tip_in,
  );

  // ── 4. Phase-out fraction ──────────────────────────────────────────────────
  const phase_out_fraction = computePhaseOutFraction(magi_cents, filing_status);

  // ── 5. Cap + final deduction amount ───────────────────────────────────────
  const cap_cents = OBBBA_REFERENCE_DATA.cap_cents_by_filing_status[filing_status];
  const deduction_amount_cents = computeDeductionAmount(
    qualified_tip_income_cents,
    cap_cents,
    phase_out_fraction,
  );

  const qualifies = deduction_amount_cents > 0;
  let reason_if_zero = '';

  if (!qualifies) {
    if (phase_out_fraction >= 1) {
      reason_if_zero = REASON_PHASED_OUT;
    } else {
      reason_if_zero = REASON_ZERO_TIPS;
    }
  }

  return {
    qualifies,
    qualified_tip_income_cents,
    deduction_amount_cents,
    phase_out_fraction,
    filing_status_applied: filing_status,
    ttoc_code_applied: ttoc_code,
    reason_if_zero,
    computed_at_utc,
    module_version: OBBBA_REFERENCE_DATA.module_version,
    transition_relief_applies,
  };
}
