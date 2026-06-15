/**
 * Pure tool implementations for the no-tax-on-tips MCP server.
 *
 * Separated from index.ts (the stdio server bootstrap) so they are unit-testable
 * without starting a transport. USD in / USD out at this boundary; ALL internal
 * math is integer cents via the verbatim-copied logic layer.
 *
 * estimate_tip_deduction routes through the canonical applyDeduction() — the same
 * fully-gated entry point the app uses — so the MCP surface cannot diverge from
 * the eligibility gating (TTOC occupation + 2025-2028 sunset + MAGI phase-out).
 * This closes the gap where the old estimate path returned a dollar amount for an
 * occupation that was never checked.
 */
import {
  applyDeduction,
  checkSunsetWindow,
  checkTransitionRelief,
  isTTOCEligible,
  computePhaseOutFraction,
  OBBBA_REFERENCE_DATA,
  type FilingStatus,
} from './logic/index.js';

export const DISCLAIMER_SHORT =
  'INFORMATIONAL ONLY — NOT TAX ADVICE. Verify with IRS (irs.gov/TippedOccupations) and a qualified tax professional. ' +
  'Occupation codes are DESCRIPTIVE PLACEHOLDER SLUGS, not validated 3-digit numeric Treasury codes from IRS final regs ' +
  '(Federal Register 2026-07104). Applies to tax years 2025-2028 only.';

export function dollarsToCents(usd: number): number {
  // Round to nearest cent to avoid floating-point representation issues
  return Math.round(usd * 100);
}
export function centsToDollars(cents: number): number {
  return cents / 100;
}

// ---------------------------------------------------------------------------
// check_tip_deduction_eligibility
// ---------------------------------------------------------------------------

export interface EligibilityInput {
  occupation_code: string;
  magi_usd: number;
  filing_status: FilingStatus;
  tax_year: number;
}

export function checkEligibility(input: EligibilityInput) {
  const { occupation_code, magi_usd, filing_status, tax_year } = input;
  const magi_cents = dollarsToCents(magi_usd);

  const in_sunset_window = checkSunsetWindow(tax_year);
  const transition_relief = checkTransitionRelief(tax_year);
  const ttoc_eligible = isTTOCEligible(occupation_code);
  const phase_out_fraction = in_sunset_window
    ? computePhaseOutFraction(magi_cents, filing_status)
    : 0;
  const eligible = in_sunset_window && ttoc_eligible && phase_out_fraction < 1;

  const notes: string[] = [];
  if (!in_sunset_window) {
    notes.push(`Tax year ${tax_year} is outside the OBBBA sunset window (2025-2028).`);
  }
  if (!ttoc_eligible) {
    notes.push(
      `Occupation code "${occupation_code}" is not in the TTOC eligible set. ` +
      'Use list_eligible_occupations to see valid codes.',
    );
  }
  if (phase_out_fraction >= 1) {
    notes.push(
      `MAGI of $${magi_usd.toLocaleString()} fully phases out the deduction for ${filing_status} filers ` +
      `(full phase-out at $${centsToDollars(
        OBBBA_REFERENCE_DATA.phase_out_by_filing_status[filing_status].full_cents,
      ).toLocaleString()}).`,
    );
  } else if (phase_out_fraction > 0) {
    notes.push(
      `MAGI of $${magi_usd.toLocaleString()} is in the phase-out range — ` +
      `${(phase_out_fraction * 100).toFixed(1)}% of the deduction is reduced.`,
    );
  }
  if (transition_relief && in_sunset_window) {
    notes.push('Tax year 2025: transition relief applies — separate-reporting requirement waived.');
  }

  return { in_sunset_window, transition_relief, ttoc_eligible, phase_out_fraction, eligible, notes };
}

// ---------------------------------------------------------------------------
// estimate_tip_deduction (routes through canonical applyDeduction — gated)
// ---------------------------------------------------------------------------

export interface EstimateInput {
  qualified_tips_usd: number;
  occupation_code: string;
  magi_usd: number;
  filing_status: FilingStatus;
  tax_year: number;
}

export function estimateDeduction(input: EstimateInput) {
  const { qualified_tips_usd, occupation_code, magi_usd, filing_status, tax_year } = input;
  const qualified_cents = dollarsToCents(qualified_tips_usd);
  const cap_cents = OBBBA_REFERENCE_DATA.cap_cents_by_filing_status[filing_status];

  // Map the pre-netted qualified tips into the tip_breakdown as tip_cash; the
  // copied computeQualifiedTipIncome(c, 0, 0, 0) === c, so this is faithful.
  const result = applyDeduction({
    gross_income_cents: qualified_cents,
    tip_breakdown: { tip_cash: qualified_cents, tip_credit: 0, tip_out: 0, tip_in: 0 },
    magi_cents: dollarsToCents(magi_usd),
    filing_status,
    ttoc_code: occupation_code,
    tax_year,
  });

  return {
    qualifies: result.qualifies,
    occupation_code_eligible: isTTOCEligible(occupation_code),
    deduction_usd: centsToDollars(result.deduction_amount_cents),
    // Renamed from qualified_tips_usd to avoid colliding with the INPUT field name:
    // this is the qualified tips after the statutory cap is applied.
    capped_qualified_tips_usd: centsToDollars(Math.min(qualified_cents, cap_cents)),
    cap_usd: centsToDollars(cap_cents),
    phase_out_fraction: result.phase_out_fraction,
    reason_if_zero: result.reason_if_zero,
    transition_relief_applies: result.transition_relief_applies,
  };
}

// ---------------------------------------------------------------------------
// list_eligible_occupations / get_obbba_reference
// ---------------------------------------------------------------------------

export function listEligibleOccupations() {
  return {
    occupations: OBBBA_REFERENCE_DATA.onboarding_picker_subset,
    count: OBBBA_REFERENCE_DATA.onboarding_picker_subset.length,
    disclaimer:
      'These codes are DESCRIPTIVE PLACEHOLDER SLUGS (e.g. "bartender_barback"), NOT the validated ' +
      '3-digit numeric Treasury codes from IRS final regs (Federal Register 2026-07104). ' +
      'Operator validation pending (reviewed_by_operator_at_utc = 0). ' + DISCLAIMER_SHORT,
  };
}

export function getObbbaReference() {
  const ref = OBBBA_REFERENCE_DATA;
  const band = (fs: FilingStatus) => ({
    threshold_usd: centsToDollars(ref.phase_out_by_filing_status[fs].threshold_cents),
    full_phase_out_usd: centsToDollars(ref.phase_out_by_filing_status[fs].full_cents),
  });
  return {
    caps: {
      single_usd: centsToDollars(ref.cap_cents_by_filing_status.single),
      head_of_household_usd: centsToDollars(ref.cap_cents_by_filing_status.head_of_household),
      married_filing_jointly_usd: centsToDollars(ref.cap_cents_by_filing_status.married_filing_jointly),
      married_filing_separately_usd: centsToDollars(ref.cap_cents_by_filing_status.married_filing_separately),
    },
    phase_out_bands: {
      single: band('single'),
      head_of_household: band('head_of_household'),
      married_filing_jointly: band('married_filing_jointly'),
      married_filing_separately: band('married_filing_separately'),
    },
    sunset_window: {
      start_tax_year: 2025,
      end_tax_year: 2028,
      sunset_start_utc: ref.sunset_start_utc,
      sunset_end_utc: ref.sunset_end_utc,
    },
    transition_relief_through_tax_year: ref.transition_relief_through_tax_year,
    module_version: ref.module_version,
    source_urls: {
      irs_tipped_occupations: ref.reference_pub_url,
      federal_register_final_regs: ref.final_regs_federal_register_url,
    },
    reviewed_by_operator_at_utc: ref.reviewed_by_operator_at_utc,
    disclaimers: [
      'INFORMATIONAL ONLY — NOT TAX ADVICE. Verify with IRS (irs.gov/TippedOccupations) and a qualified tax professional before making any tax decision.',
      'The TTOC occupation codes here are DESCRIPTIVE PLACEHOLDER SLUGS, NOT the validated 3-digit numeric Treasury codes from the IRS final regs (Federal Register 2026-07104). Operator validation is pending (reviewed_by_operator_at_utc = 0).',
      'Applies to tax years 2025-2028 (OBBBA sunset). Per-filing-status caps and MAGI phase-outs apply.',
      `module_version: ${ref.module_version}`,
    ],
  };
}
