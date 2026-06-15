/**
 * Tool-layer tests — the eligibility gate that the GREEN gate originally missed.
 *
 * estimate_tip_deduction must NOT return a non-zero deduction for an occupation
 * that is not TTOC-eligible, an out-of-window year, or a fully phased-out MAGI.
 * These assert the tool routes through the canonical, fully-gated applyDeduction.
 */
import { describe, it, expect } from 'vitest';
import { estimateDeduction, checkEligibility } from '../tools.js';

const ELIGIBLE = 'bartender_barback'; // present in ttoc-codes all_codes
const INELIGIBLE = 'software_engineer'; // not a tipped occupation

describe('estimateDeduction — eligibility gate (regression for the missed bug)', () => {
  it('eligible occupation, $30k tips, single, 2026, MAGI $100k → $25,000 (capped), qualifies', () => {
    const r = estimateDeduction({
      qualified_tips_usd: 30_000, occupation_code: ELIGIBLE,
      filing_status: 'single', tax_year: 2026, magi_usd: 100_000,
    });
    expect(r.deduction_usd).toBe(25_000);
    expect(r.qualifies).toBe(true);
    expect(r.occupation_code_eligible).toBe(true);
    expect(r.capped_qualified_tips_usd).toBe(25_000);
    expect(r.cap_usd).toBe(25_000);
    expect(r.reason_if_zero).toBe('');
  });

  it('INELIGIBLE occupation → deduction $0, qualifies false, TTOC reason (the fix)', () => {
    const r = estimateDeduction({
      qualified_tips_usd: 30_000, occupation_code: INELIGIBLE,
      filing_status: 'single', tax_year: 2026, magi_usd: 100_000,
    });
    expect(r.deduction_usd).toBe(0);
    expect(r.qualifies).toBe(false);
    expect(r.occupation_code_eligible).toBe(false);
    expect(r.reason_if_zero).toMatch(/TTOC/i);
  });

  it('out-of-window year (2030), eligible occupation → deduction $0, window reason', () => {
    const r = estimateDeduction({
      qualified_tips_usd: 30_000, occupation_code: ELIGIBLE,
      filing_status: 'single', tax_year: 2030, magi_usd: 100_000,
    });
    expect(r.deduction_usd).toBe(0);
    expect(r.qualifies).toBe(false);
    expect(r.reason_if_zero).toMatch(/window/i);
  });

  it('full phase-out (single, MAGI $400k), eligible → deduction $0, phased-out reason', () => {
    const r = estimateDeduction({
      qualified_tips_usd: 30_000, occupation_code: ELIGIBLE,
      filing_status: 'single', tax_year: 2026, magi_usd: 400_000,
    });
    expect(r.deduction_usd).toBe(0);
    expect(r.phase_out_fraction).toBe(1);
    expect(r.reason_if_zero).toMatch(/phased out/i);
  });

  it('partial phase-out (single, MAGI $200k), eligible → $20,000 (0.2 reduction)', () => {
    const r = estimateDeduction({
      qualified_tips_usd: 25_000, occupation_code: ELIGIBLE,
      filing_status: 'single', tax_year: 2026, magi_usd: 200_000,
    });
    expect(r.deduction_usd).toBe(20_000);
    expect(r.qualifies).toBe(true);
  });

  it('MFS cap $12,500 honored for eligible occupation', () => {
    const r = estimateDeduction({
      qualified_tips_usd: 30_000, occupation_code: ELIGIBLE,
      filing_status: 'married_filing_separately', tax_year: 2026, magi_usd: 50_000,
    });
    expect(r.deduction_usd).toBe(12_500);
    expect(r.cap_usd).toBe(12_500);
  });
});

describe('checkEligibility', () => {
  it('eligible occupation, in-window, low MAGI → eligible true', () => {
    const r = checkEligibility({ occupation_code: ELIGIBLE, magi_usd: 50_000, filing_status: 'single', tax_year: 2026 });
    expect(r.eligible).toBe(true);
    expect(r.ttoc_eligible).toBe(true);
  });

  it('ineligible occupation → eligible false, ttoc_eligible false', () => {
    const r = checkEligibility({ occupation_code: INELIGIBLE, magi_usd: 50_000, filing_status: 'single', tax_year: 2026 });
    expect(r.eligible).toBe(false);
    expect(r.ttoc_eligible).toBe(false);
  });

  it('transition relief flagged for tax year 2025', () => {
    const r = checkEligibility({ occupation_code: ELIGIBLE, magi_usd: 50_000, filing_status: 'single', tax_year: 2025 });
    expect(r.transition_relief).toBe(true);
  });
});
