/**
 * Unit tests — OBBBA deduction computation module
 *
 * Covers:
 *   - computeQualifiedTipIncome: cash+credit+tip_in-tip_out; negative floors to 0
 *   - computeDeductionAmount: uncapped, capped, with phase-out fraction
 *
 * All values are integer cents per ADR 010 Principle 1.
 *
 * Ported verbatim from nightshift-v2 source tests (removed @cloudflare/vitest-pool-workers
 * reference type — not applicable in Node/stdio MCP context).
 *
 * Cross-refs:
 *   decisions/030-no-tax-on-tips-federal-deduction.md §Behavior
 *   decisions/030-no-tax-on-tips-federal-deduction.md §Integration gate items 4-6
 */

import { describe, it, expect } from 'vitest';
import {
  computeQualifiedTipIncome,
  computeDeductionAmount,
} from '../computation.js';

// ---------------------------------------------------------------------------
// computeQualifiedTipIncome
// ---------------------------------------------------------------------------

describe('computeQualifiedTipIncome', () => {
  it('returns sum of cash + credit when no tip_out or tip_in', () => {
    // $1,000 cash + $500 credit = $1,500
    expect(computeQualifiedTipIncome(100_000, 50_000, 0, 0)).toBe(150_000);
  });

  it('includes tip_in in the qualifying total', () => {
    // $1,000 cash + $500 credit + $200 tip_in = $1,700
    expect(computeQualifiedTipIncome(100_000, 50_000, 0, 20_000)).toBe(170_000);
  });

  it('subtracts tip_out from the total', () => {
    // $1,000 cash + $500 credit + $200 tip_in - $300 tip_out = $1,400
    expect(computeQualifiedTipIncome(100_000, 50_000, 30_000, 20_000)).toBe(140_000);
  });

  it('floors negative result at 0 (tip_out exceeds all tip income)', () => {
    // $100 cash - $500 tip_out → would be -$400, floors to 0
    expect(computeQualifiedTipIncome(10_000, 0, 50_000, 0)).toBe(0);
  });

  it('returns 0 when all inputs are 0', () => {
    expect(computeQualifiedTipIncome(0, 0, 0, 0)).toBe(0);
  });

  it('returns 0 when tips exactly equal tip_out (no net tips)', () => {
    // $2,000 tips - $2,000 tip_out = 0
    expect(computeQualifiedTipIncome(200_000, 0, 200_000, 0)).toBe(0);
  });

  it('handles large tip amounts correctly', () => {
    // $25,000 cash tips = 2_500_000 cents
    expect(computeQualifiedTipIncome(2_500_000, 0, 0, 0)).toBe(2_500_000);
  });

  it('Fixture 8 tip breakdown: cash $20K + credit $5K + tip_in $1K - tip_out $3K = $23K', () => {
    // $20K cash, $5K credit, $3K tip_out, $1K tip_in
    const result = computeQualifiedTipIncome(2_000_000, 500_000, 300_000, 100_000);
    expect(result).toBe(2_300_000); // $23,000
  });
});

// ---------------------------------------------------------------------------
// computeDeductionAmount
// ---------------------------------------------------------------------------

describe('computeDeductionAmount', () => {
  it('returns full qualified amount when under cap and no phase-out', () => {
    // $15K qualified tips, $25K cap, 0 phase-out → deduction = $15K
    expect(computeDeductionAmount(1_500_000, 2_500_000, 0)).toBe(1_500_000);
  });

  it('caps deduction at the filing-status cap when tips exceed cap', () => {
    // $30K qualified tips, $25K cap, 0 phase-out → deduction = $25K
    expect(computeDeductionAmount(3_000_000, 2_500_000, 0)).toBe(2_500_000);
  });

  it('applies phase-out fraction correctly (0.2 → 80% of capped amount)', () => {
    // $25K qualified, $25K cap → capped = $25K; × (1 - 0.2) = $20K
    expect(computeDeductionAmount(2_500_000, 2_500_000, 0.2)).toBe(2_000_000);
  });

  it('returns 0 when phase_out_fraction is 1.0 (fully phased out)', () => {
    expect(computeDeductionAmount(2_500_000, 2_500_000, 1.0)).toBe(0);
  });

  it('returns 0 when qualified_tips_cents is 0', () => {
    expect(computeDeductionAmount(0, 2_500_000, 0)).toBe(0);
  });

  it('caps first, then applies phase-out (not phase-out first)', () => {
    // $30K qualified, $25K cap, 0.5 phase-out
    // correct:  min(30K, 25K) × (1 - 0.5) = 25K × 0.5 = $12.5K
    // wrong if order swapped: 30K × 0.5 = 15K → still capped at 25K ≠ same
    expect(computeDeductionAmount(3_000_000, 2_500_000, 0.5)).toBe(1_250_000);
  });

  it('rounds to nearest cent (integer output)', () => {
    // $25K × (1 - 0.333...) = $16,666.67 → rounds to $16,667
    const result = computeDeductionAmount(2_500_000, 2_500_000, 1 / 3);
    expect(Number.isInteger(result)).toBe(true);
    // 2_500_000 × (2/3) ≈ 1_666_667
    expect(result).toBeCloseTo(1_666_667, 0);
  });

  it('MFS cap: $15K qualified tips under $12.5K cap → deduction = $12.5K', () => {
    // $15K qualified, $12.5K cap, 0 phase-out → capped at $12.5K
    expect(computeDeductionAmount(1_500_000, 1_250_000, 0)).toBe(1_250_000);
  });
});
