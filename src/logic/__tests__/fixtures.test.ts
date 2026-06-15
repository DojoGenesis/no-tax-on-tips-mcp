/**
 * Integration fixture tests — applyDeduction() end-to-end
 *
 * 8 hand-calculated reference cases per ADR 030 §Integration gate item 6.
 * These are the canonical reference values; if math constants change
 * (reference-data.ts update), re-verify each fixture against the new values.
 *
 * All monetary values in cents (integer minor units per ADR 010 Principle 1).
 * $1 = 100 cents; $25,000 = 2_500_000 cents; $12,500 = 1_250_000 cents.
 *
 * Ported verbatim from nightshift-v2 source tests (removed @cloudflare/vitest-pool-workers
 * reference type — not applicable in Node/stdio MCP context).
 *
 * Cross-refs:
 *   decisions/030-no-tax-on-tips-federal-deduction.md §Integration gate item 6
 */

import { describe, it, expect } from 'vitest';
import {
  applyDeduction,
  REASON_OUTSIDE_WINDOW,
  REASON_NOT_TTOC,
  REASON_PHASED_OUT,
} from '../index.js';
import type { OBBBADeductionInput } from '../index.js';

// ---------------------------------------------------------------------------
// Fixture 1 — server, MFJ, $40K MAGI, $25K qualified tips, 2026
// Expected: deduction = $25,000 (no phase-out, at cap, eligible, in window)
// ---------------------------------------------------------------------------

describe('Fixture 1: server MFJ $40K MAGI $25K tips 2026 → $25K deduction', () => {
  const input: OBBBADeductionInput = {
    gross_income_cents: 4_000_000,       // $40,000
    tip_breakdown: {
      tip_cash: 2_500_000,               // $25,000
      tip_credit: 0,
      tip_out: 0,
      tip_in: 0,
    },
    magi_cents: 4_000_000,               // $40,000 — well below $300K MFJ threshold
    filing_status: 'married_filing_jointly',
    ttoc_code: 'wait_staff',
    tax_year: 2026,
  };

  it('qualifies = true', () => {
    expect(applyDeduction(input).qualifies).toBe(true);
  });

  it('qualified_tip_income_cents = $25,000', () => {
    expect(applyDeduction(input).qualified_tip_income_cents).toBe(2_500_000);
  });

  it('deduction_amount_cents = $25,000 (at cap, no phase-out)', () => {
    expect(applyDeduction(input).deduction_amount_cents).toBe(2_500_000);
  });

  it('phase_out_fraction = 0', () => {
    expect(applyDeduction(input).phase_out_fraction).toBe(0);
  });

  it('audit trail: filing_status_applied echoes input', () => {
    expect(applyDeduction(input).filing_status_applied).toBe('married_filing_jointly');
  });

  it('audit trail: ttoc_code_applied echoes input', () => {
    expect(applyDeduction(input).ttoc_code_applied).toBe('wait_staff');
  });

  it('module_version is "1.0.0-2026-04-13"', () => {
    expect(applyDeduction(input).module_version).toBe('1.0.0-2026-04-13');
  });

  it('transition_relief_applies is false for 2026', () => {
    expect(applyDeduction(input).transition_relief_applies).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fixture 2 — server, single, $200K MAGI, $25K qualified tips, 2026
// Phase-out: (200K - 150K) / (400K - 150K) = 50K / 250K = 0.2
// Expected: deduction = $25K × (1 - 0.2) = $20,000
// ---------------------------------------------------------------------------

describe('Fixture 2: server single $200K MAGI $25K tips 2026 → $20K deduction (phase-out 0.2)', () => {
  const input: OBBBADeductionInput = {
    gross_income_cents: 20_000_000,
    tip_breakdown: {
      tip_cash: 2_500_000,
      tip_credit: 0,
      tip_out: 0,
      tip_in: 0,
    },
    magi_cents: 20_000_000,              // $200,000 — in single phase-out range
    filing_status: 'single',
    ttoc_code: 'wait_staff',
    tax_year: 2026,
  };

  it('qualifies = true', () => {
    expect(applyDeduction(input).qualifies).toBe(true);
  });

  it('phase_out_fraction ≈ 0.2', () => {
    expect(applyDeduction(input).phase_out_fraction).toBeCloseTo(0.2, 10);
  });

  it('deduction_amount_cents = $20,000', () => {
    expect(applyDeduction(input).deduction_amount_cents).toBe(2_000_000);
  });
});

// ---------------------------------------------------------------------------
// Fixture 3 — server, single, $400K MAGI, $25K qualified tips, 2026
// Phase-out fraction = 1.0 (fully phased out)
// Expected: deduction = $0, reason = MAGI fully phased out
// ---------------------------------------------------------------------------

describe('Fixture 3: server single $400K MAGI → $0 deduction (fully phased out)', () => {
  const input: OBBBADeductionInput = {
    gross_income_cents: 40_000_000,
    tip_breakdown: {
      tip_cash: 2_500_000,
      tip_credit: 0,
      tip_out: 0,
      tip_in: 0,
    },
    magi_cents: 40_000_000,              // $400,000 — at full phase-out
    filing_status: 'single',
    ttoc_code: 'wait_staff',
    tax_year: 2026,
  };

  it('qualifies = false', () => {
    expect(applyDeduction(input).qualifies).toBe(false);
  });

  it('deduction_amount_cents = 0', () => {
    expect(applyDeduction(input).deduction_amount_cents).toBe(0);
  });

  it('phase_out_fraction = 1', () => {
    expect(applyDeduction(input).phase_out_fraction).toBe(1);
  });

  it('reason_if_zero = REASON_PHASED_OUT', () => {
    expect(applyDeduction(input).reason_if_zero).toBe(REASON_PHASED_OUT);
  });
});

// ---------------------------------------------------------------------------
// Fixture 4 — server, single, $40K MAGI, $30K qualified tips, 2026
// Tips exceed cap → capped at $25K; no phase-out
// Expected: deduction = $25,000 (capped)
// ---------------------------------------------------------------------------

describe('Fixture 4: server single $40K MAGI $30K tips → $25K deduction (capped)', () => {
  const input: OBBBADeductionInput = {
    gross_income_cents: 4_000_000,
    tip_breakdown: {
      tip_cash: 3_000_000,               // $30,000 — exceeds $25K cap
      tip_credit: 0,
      tip_out: 0,
      tip_in: 0,
    },
    magi_cents: 4_000_000,               // $40,000 — below threshold
    filing_status: 'single',
    ttoc_code: 'wait_staff',
    tax_year: 2026,
  };

  it('qualified_tip_income_cents = $30,000', () => {
    expect(applyDeduction(input).qualified_tip_income_cents).toBe(3_000_000);
  });

  it('deduction_amount_cents = $25,000 (capped)', () => {
    expect(applyDeduction(input).deduction_amount_cents).toBe(2_500_000);
  });

  it('qualifies = true', () => {
    expect(applyDeduction(input).qualifies).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Fixture 5 — ineligible_occupation, single, $40K MAGI, $25K qualified tips, 2026
// Expected: deduction = $0, reason = "Occupation not on TTOC list"
// ---------------------------------------------------------------------------

describe('Fixture 5: ineligible occupation → $0 deduction (not on TTOC list)', () => {
  const input: OBBBADeductionInput = {
    gross_income_cents: 4_000_000,
    tip_breakdown: {
      tip_cash: 2_500_000,
      tip_credit: 0,
      tip_out: 0,
      tip_in: 0,
    },
    magi_cents: 4_000_000,
    filing_status: 'single',
    ttoc_code: 'ineligible_occupation',  // not on TTOC list
    tax_year: 2026,
  };

  it('qualifies = false', () => {
    expect(applyDeduction(input).qualifies).toBe(false);
  });

  it('deduction_amount_cents = 0', () => {
    expect(applyDeduction(input).deduction_amount_cents).toBe(0);
  });

  it('reason_if_zero = "Occupation not on TTOC list"', () => {
    expect(applyDeduction(input).reason_if_zero).toBe(REASON_NOT_TTOC);
  });
});

// ---------------------------------------------------------------------------
// Fixture 6 — server, single, $40K MAGI, $25K qualified tips, tax year 2024
// Outside 2025-2028 window
// Expected: deduction = $0, reason = "Outside 2025-2028 sunset window"
// ---------------------------------------------------------------------------

describe('Fixture 6: tax year 2024 → $0 deduction (outside sunset window)', () => {
  const input: OBBBADeductionInput = {
    gross_income_cents: 4_000_000,
    tip_breakdown: {
      tip_cash: 2_500_000,
      tip_credit: 0,
      tip_out: 0,
      tip_in: 0,
    },
    magi_cents: 4_000_000,
    filing_status: 'single',
    ttoc_code: 'wait_staff',
    tax_year: 2024,                      // before OBBBA window
  };

  it('qualifies = false', () => {
    expect(applyDeduction(input).qualifies).toBe(false);
  });

  it('deduction_amount_cents = 0', () => {
    expect(applyDeduction(input).deduction_amount_cents).toBe(0);
  });

  it('reason_if_zero = "Outside 2025-2028 sunset window"', () => {
    expect(applyDeduction(input).reason_if_zero).toBe(REASON_OUTSIDE_WINDOW);
  });

  it('transition_relief_applies = false for 2024', () => {
    expect(applyDeduction(input).transition_relief_applies).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Fixture 7 — server, MFS, $40K MAGI, $15K qualified tips, 2026
// MFS cap = $12,500; tips > cap → capped at $12,500; no phase-out
// Expected: deduction = $12,500
// ---------------------------------------------------------------------------

describe('Fixture 7: server MFS $40K MAGI $15K tips → $12.5K deduction (MFS cap)', () => {
  const input: OBBBADeductionInput = {
    gross_income_cents: 4_000_000,
    tip_breakdown: {
      tip_cash: 1_500_000,               // $15,000 — exceeds $12.5K MFS cap
      tip_credit: 0,
      tip_out: 0,
      tip_in: 0,
    },
    magi_cents: 4_000_000,               // $40,000 — below $150K MFS threshold
    filing_status: 'married_filing_separately',
    ttoc_code: 'wait_staff',
    tax_year: 2026,
  };

  it('qualified_tip_income_cents = $15,000', () => {
    expect(applyDeduction(input).qualified_tip_income_cents).toBe(1_500_000);
  });

  it('deduction_amount_cents = $12,500 (MFS cap)', () => {
    expect(applyDeduction(input).deduction_amount_cents).toBe(1_250_000);
  });

  it('qualifies = true', () => {
    expect(applyDeduction(input).qualifies).toBe(true);
  });

  it('filing_status_applied echoes married_filing_separately', () => {
    expect(applyDeduction(input).filing_status_applied).toBe('married_filing_separately');
  });
});

// ---------------------------------------------------------------------------
// Fixture 8 — server, single, $40K MAGI, mixed tip breakdown, 2026
// tip_cash $20K + tip_credit $5K + tip_in $1K - tip_out $3K = $23K qualified
// Under $25K cap; no phase-out → deduction = $23K
// ---------------------------------------------------------------------------

describe('Fixture 8: mixed tip breakdown → $23K qualified, $23K deduction', () => {
  const input: OBBBADeductionInput = {
    gross_income_cents: 4_000_000,
    tip_breakdown: {
      tip_cash: 2_000_000,               // $20,000
      tip_credit: 500_000,               // $5,000
      tip_out: 300_000,                  // $3,000 — tip-pool payout reduces qualifying tips
      tip_in: 100_000,                   // $1,000 — tip-pool receipt
    },
    magi_cents: 4_000_000,               // $40,000 — below threshold
    filing_status: 'single',
    ttoc_code: 'wait_staff',
    tax_year: 2026,
  };

  it('qualified_tip_income_cents = $23,000 (20K + 5K + 1K - 3K)', () => {
    expect(applyDeduction(input).qualified_tip_income_cents).toBe(2_300_000);
  });

  it('deduction_amount_cents = $23,000 (under cap, no phase-out)', () => {
    expect(applyDeduction(input).deduction_amount_cents).toBe(2_300_000);
  });

  it('qualifies = true', () => {
    expect(applyDeduction(input).qualifies).toBe(true);
  });

  it('phase_out_fraction = 0', () => {
    expect(applyDeduction(input).phase_out_fraction).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Fixture: transition relief — tax year 2025 is in window, relief applies
// ---------------------------------------------------------------------------

describe('Transition relief: tax year 2025', () => {
  const input: OBBBADeductionInput = {
    gross_income_cents: 4_000_000,
    tip_breakdown: {
      tip_cash: 2_500_000,
      tip_credit: 0,
      tip_out: 0,
      tip_in: 0,
    },
    magi_cents: 4_000_000,
    filing_status: 'single',
    ttoc_code: 'wait_staff',
    tax_year: 2025,
  };

  it('qualifies = true for 2025', () => {
    expect(applyDeduction(input).qualifies).toBe(true);
  });

  it('transition_relief_applies = true for 2025', () => {
    expect(applyDeduction(input).transition_relief_applies).toBe(true);
  });

  it('deduction_amount_cents = $25,000 for 2025 (math same as 2026)', () => {
    expect(applyDeduction(input).deduction_amount_cents).toBe(2_500_000);
  });
});

// ---------------------------------------------------------------------------
// Audit trail — computed_at_utc is an integer unix epoch
// ---------------------------------------------------------------------------

describe('applyDeduction: output shape invariants', () => {
  const input: OBBBADeductionInput = {
    gross_income_cents: 4_000_000,
    tip_breakdown: { tip_cash: 1_000_000, tip_credit: 0, tip_out: 0, tip_in: 0 },
    magi_cents: 4_000_000,
    filing_status: 'single',
    ttoc_code: 'wait_staff',
    tax_year: 2026,
  };

  it('computed_at_utc is an integer', () => {
    const result = applyDeduction(input);
    expect(Number.isInteger(result.computed_at_utc)).toBe(true);
  });

  it('computed_at_utc is a plausible unix epoch (> 2026-01-01)', () => {
    const result = applyDeduction(input);
    expect(result.computed_at_utc).toBeGreaterThan(1_735_689_600); // 2025-01-01T00:00:00Z
  });

  it('module_version is exactly "1.0.0-2026-04-13"', () => {
    expect(applyDeduction(input).module_version).toBe('1.0.0-2026-04-13');
  });
});
