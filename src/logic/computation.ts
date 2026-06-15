/**
 * OBBBA No-Tax-on-Tips Deduction — Computation
 *
 * Exports:
 *   computeQualifiedTipIncome(tip_cash, tip_credit, tip_out, tip_in) → cents
 *   computeDeductionAmount(qualified_tips_cents, cap_cents, phase_out_fraction) → cents
 *
 * All monetary values are INTEGER minor units (cents). No floats in storage or output.
 * Float arithmetic is used only for intermediate phase-out computation; results are
 * Math.round()ed to integer cents before return.
 *
 * Workers-compatible — no Node-only APIs.
 *
 * Cross-refs:
 *   decisions/030-no-tax-on-tips-federal-deduction.md §Behavior
 *   decisions/030-no-tax-on-tips-federal-deduction.md §Integration gate items 4-6
 *   ADR 010 Principle 1 — integer minor units, no float storage
 */

// ---------------------------------------------------------------------------
// Qualified tip income
// ---------------------------------------------------------------------------

/**
 * Computes net qualified tip income eligible for the OBBBA deduction.
 *
 * Formula: qualified = (tip_cash + tip_credit + tip_in) - tip_out
 * Floored at 0 — negative net tip income yields 0 (worker cannot have
 * negative qualified tip income for purposes of the deduction).
 *
 * Per ADR 030 §Behavior:
 *   - tip_cash:   cash tips received voluntarily
 *   - tip_credit: credit/digital tips received voluntarily
 *   - tip_in:     tips received from tip-pool distribution (from co-workers)
 *   - tip_out:    tips paid out to other workers (reduces qualifying amount)
 *
 * Mandatory service charges (auto-gratuity) are excluded upstream by the
 * caller — they must NOT be passed as any of the tip_* parameters here.
 *
 * All parameters are integer cents. Returns integer cents.
 *
 * @param tip_cash   - cash tips received (cents, ≥ 0)
 * @param tip_credit - credit/digital tips received (cents, ≥ 0)
 * @param tip_out    - tips paid out to other workers (cents, ≥ 0)
 * @param tip_in     - tips received from tip-pool distribution (cents, ≥ 0)
 */
export function computeQualifiedTipIncome(
  tip_cash: number,
  tip_credit: number,
  tip_out: number,
  tip_in: number,
): number {
  const gross = tip_cash + tip_credit + tip_in;
  const net = gross - tip_out;
  return Math.max(0, net);
}

// ---------------------------------------------------------------------------
// Deduction amount
// ---------------------------------------------------------------------------

/**
 * Computes the final OBBBA deduction amount after applying the per-filing-status
 * cap and the MAGI phase-out fraction.
 *
 * Formula:
 *   capped  = min(qualified_tips_cents, cap_cents)
 *   allowed = capped × (1 - phase_out_fraction)
 *   result  = Math.round(allowed)   // integer cents
 *
 * The cap is applied BEFORE the phase-out fraction (cap first, then reduce).
 * This matches the IRS statutory ordering per ADR 030 §Behavior.
 *
 * All monetary values are integer cents. phase_out_fraction is a float in [0, 1].
 * Returns integer cents.
 *
 * @param qualified_tips_cents - net qualified tip income from computeQualifiedTipIncome()
 * @param cap_cents            - filing-status-aware cap from OBBBA_REFERENCE_DATA
 * @param phase_out_fraction   - value from computePhaseOutFraction() (0 = no reduction, 1 = fully phased out)
 */
export function computeDeductionAmount(
  qualified_tips_cents: number,
  cap_cents: number,
  phase_out_fraction: number,
): number {
  const capped = Math.min(qualified_tips_cents, cap_cents);
  const allowed = capped * (1 - phase_out_fraction);
  return Math.round(allowed);
}
