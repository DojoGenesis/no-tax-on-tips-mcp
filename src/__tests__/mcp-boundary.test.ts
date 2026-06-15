/**
 * MCP boundary assertions — estimate_tip_deduction tool
 *
 * Validates the USD boundary conversion layer wrapping the copied
 * integer-cents logic. Tests are expressed in USD (tool interface level)
 * and assert the expected deduction_usd outputs.
 *
 * All assertions are derived from the copied reference-data constants:
 *   single/HoH/MFJ cap:  $25,000
 *   MFS cap:              $12,500
 *   single/HoH phase-out: $150,000 → $400,000
 *   MFJ phase-out:        $300,000 → $550,000
 *   MFS phase-out:        $150,000 → $275,000
 */

import { describe, it, expect } from 'vitest';
import {
  computePhaseOutFraction,
  computeDeductionAmount,
  OBBBA_REFERENCE_DATA,
} from '../logic/index.js';
import type { FilingStatus } from '../logic/index.js';

// Helper: mirrors the boundary conversion in src/index.ts
function dollarsToCents(usd: number): number {
  return Math.round(usd * 100);
}
function centsToDollars(cents: number): number {
  return cents / 100;
}

function estimateDeductionUsd(
  qualified_tips_usd: number,
  filing_status: FilingStatus,
  magi_usd: number,
): number {
  const qualified_tips_cents = dollarsToCents(qualified_tips_usd);
  const magi_cents = dollarsToCents(magi_usd);
  const cap_cents = OBBBA_REFERENCE_DATA.cap_cents_by_filing_status[filing_status];
  const phase_out_fraction = computePhaseOutFraction(magi_cents, filing_status);
  const deduction_cents = computeDeductionAmount(qualified_tips_cents, cap_cents, phase_out_fraction);
  return centsToDollars(deduction_cents);
}

// ---------------------------------------------------------------------------
// Cap boundary: $25,000 single/HoH/MFJ
// ---------------------------------------------------------------------------

describe('Cap boundary — single: $25,000', () => {
  it('tips exactly at $25K cap → deduction = $25,000 (no phase-out)', () => {
    expect(estimateDeductionUsd(25_000, 'single', 50_000)).toBe(25_000);
  });

  it('tips above cap ($30K) → deduction = $25,000 (capped)', () => {
    expect(estimateDeductionUsd(30_000, 'single', 50_000)).toBe(25_000);
  });

  it('tips below cap ($15K) → deduction = $15,000', () => {
    expect(estimateDeductionUsd(15_000, 'single', 50_000)).toBe(15_000);
  });
});

describe('Cap boundary — head_of_household: $25,000', () => {
  it('tips exactly at $25K cap → deduction = $25,000 (no phase-out)', () => {
    expect(estimateDeductionUsd(25_000, 'head_of_household', 50_000)).toBe(25_000);
  });

  it('tips above cap ($30K) → deduction = $25,000 (capped)', () => {
    expect(estimateDeductionUsd(30_000, 'head_of_household', 50_000)).toBe(25_000);
  });
});

describe('Cap boundary — married_filing_jointly: $25,000', () => {
  it('tips exactly at $25K cap → deduction = $25,000 (no phase-out, MAGI below $300K)', () => {
    expect(estimateDeductionUsd(25_000, 'married_filing_jointly', 50_000)).toBe(25_000);
  });

  it('tips above cap ($30K) → deduction = $25,000 (capped)', () => {
    expect(estimateDeductionUsd(30_000, 'married_filing_jointly', 50_000)).toBe(25_000);
  });
});

describe('Cap boundary — married_filing_separately: $12,500', () => {
  it('tips exactly at $12.5K MFS cap → deduction = $12,500 (no phase-out)', () => {
    expect(estimateDeductionUsd(12_500, 'married_filing_separately', 50_000)).toBe(12_500);
  });

  it('tips above MFS cap ($15K) → deduction = $12,500 (capped)', () => {
    expect(estimateDeductionUsd(15_000, 'married_filing_separately', 50_000)).toBe(12_500);
  });

  it('tips below MFS cap ($5K) → deduction = $5,000', () => {
    expect(estimateDeductionUsd(5_000, 'married_filing_separately', 50_000)).toBe(5_000);
  });
});

// ---------------------------------------------------------------------------
// Single phase-out: $150,000 → $400,000
// ---------------------------------------------------------------------------

describe('Phase-out boundary — single ($150K → $400K)', () => {
  it('MAGI below $150K → phase_out_fraction = 0 (full deduction up to cap)', () => {
    const fraction = computePhaseOutFraction(dollarsToCents(149_999), 'single');
    expect(fraction).toBe(0);
  });

  it('MAGI exactly $150K → phase_out_fraction = 0', () => {
    const fraction = computePhaseOutFraction(dollarsToCents(150_000), 'single');
    expect(fraction).toBe(0);
  });

  it('MAGI exactly $400K → phase_out_fraction = 1 (zero deduction)', () => {
    const fraction = computePhaseOutFraction(dollarsToCents(400_000), 'single');
    expect(fraction).toBe(1);
  });

  it('MAGI above $400K → phase_out_fraction = 1', () => {
    const fraction = computePhaseOutFraction(dollarsToCents(500_000), 'single');
    expect(fraction).toBe(1);
  });

  it('MAGI at $200K → deduction_usd = $20,000 (phase-out 0.2)', () => {
    // (200K - 150K) / (400K - 150K) = 50/250 = 0.2 → $25K × 0.8 = $20K
    expect(estimateDeductionUsd(25_000, 'single', 200_000)).toBe(20_000);
  });

  it('MAGI at $150K → deduction_usd = $25,000 (at threshold, no reduction)', () => {
    expect(estimateDeductionUsd(25_000, 'single', 150_000)).toBe(25_000);
  });

  it('MAGI at $400K → deduction_usd = $0 (fully phased out)', () => {
    expect(estimateDeductionUsd(25_000, 'single', 400_000)).toBe(0);
  });

  it('MAGI at $275K (midpoint) → phase-out fraction ≈ 0.5, deduction ≈ $12,500', () => {
    // (275K - 150K) / (400K - 150K) = 125/250 = 0.5
    const result = estimateDeductionUsd(25_000, 'single', 275_000);
    expect(result).toBeCloseTo(12_500, 0);
  });
});

// ---------------------------------------------------------------------------
// MFJ phase-out: $300,000 → $550,000
// ---------------------------------------------------------------------------

describe('Phase-out boundary — married_filing_jointly ($300K → $550K)', () => {
  it('MAGI below $300K → phase_out_fraction = 0', () => {
    const fraction = computePhaseOutFraction(dollarsToCents(299_999), 'married_filing_jointly');
    expect(fraction).toBe(0);
  });

  it('MAGI exactly $300K → phase_out_fraction = 0', () => {
    const fraction = computePhaseOutFraction(dollarsToCents(300_000), 'married_filing_jointly');
    expect(fraction).toBe(0);
  });

  it('MAGI exactly $550K → phase_out_fraction = 1', () => {
    const fraction = computePhaseOutFraction(dollarsToCents(550_000), 'married_filing_jointly');
    expect(fraction).toBe(1);
  });

  it('MAGI above $550K → phase_out_fraction = 1', () => {
    const fraction = computePhaseOutFraction(dollarsToCents(600_000), 'married_filing_jointly');
    expect(fraction).toBe(1);
  });

  it('MAGI at $300K → deduction_usd = $25,000 (full, no reduction)', () => {
    expect(estimateDeductionUsd(25_000, 'married_filing_jointly', 300_000)).toBe(25_000);
  });

  it('MAGI at $550K → deduction_usd = $0 (fully phased out)', () => {
    expect(estimateDeductionUsd(25_000, 'married_filing_jointly', 550_000)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// MFS phase-out: $150,000 → $275,000
// ---------------------------------------------------------------------------

describe('Phase-out boundary — married_filing_separately ($150K → $275K)', () => {
  it('MAGI below $150K → phase_out_fraction = 0', () => {
    const fraction = computePhaseOutFraction(dollarsToCents(149_999), 'married_filing_separately');
    expect(fraction).toBe(0);
  });

  it('MAGI exactly $150K → phase_out_fraction = 0', () => {
    const fraction = computePhaseOutFraction(dollarsToCents(150_000), 'married_filing_separately');
    expect(fraction).toBe(0);
  });

  it('MAGI exactly $275K → phase_out_fraction = 1', () => {
    const fraction = computePhaseOutFraction(dollarsToCents(275_000), 'married_filing_separately');
    expect(fraction).toBe(1);
  });

  it('MAGI above $275K → phase_out_fraction = 1', () => {
    const fraction = computePhaseOutFraction(dollarsToCents(300_000), 'married_filing_separately');
    expect(fraction).toBe(1);
  });

  it('MAGI at $150K → deduction_usd = $12,500 (MFS cap, no reduction)', () => {
    expect(estimateDeductionUsd(15_000, 'married_filing_separately', 150_000)).toBe(12_500);
  });

  it('MAGI at $275K → deduction_usd = $0 (fully phased out)', () => {
    expect(estimateDeductionUsd(15_000, 'married_filing_separately', 275_000)).toBe(0);
  });
});
