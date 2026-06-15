/**
 * Unit tests — OBBBA deduction eligibility module
 *
 * Covers:
 *   - checkSunsetWindow: year boundary cases (2024 false, 2025-2028 true, 2029 false)
 *   - checkTransitionRelief: 2025 true, 2026 false
 *   - isTTOCEligible: all 11 V2.0 codes → true; unknown code → false
 *   - computePhaseOutFraction: single/joint/MFS boundary + midpoint cases
 *
 * Ported verbatim from nightshift-v2 source tests (removed @cloudflare/vitest-pool-workers
 * reference type — not applicable in Node/stdio MCP context).
 *
 * Cross-refs:
 *   decisions/030-no-tax-on-tips-federal-deduction.md §Integration gate items 2-4
 */

import { describe, it, expect } from 'vitest';
import {
  checkSunsetWindow,
  checkTransitionRelief,
  isTTOCEligible,
  computePhaseOutFraction,
} from '../eligibility.js';

// ---------------------------------------------------------------------------
// checkSunsetWindow
// ---------------------------------------------------------------------------

describe('checkSunsetWindow', () => {
  it('returns false for 2024 (before window)', () => {
    expect(checkSunsetWindow(2024)).toBe(false);
  });

  it('returns true for 2025 (window start)', () => {
    expect(checkSunsetWindow(2025)).toBe(true);
  });

  it('returns true for 2026', () => {
    expect(checkSunsetWindow(2026)).toBe(true);
  });

  it('returns true for 2027', () => {
    expect(checkSunsetWindow(2027)).toBe(true);
  });

  it('returns true for 2028 (window end)', () => {
    expect(checkSunsetWindow(2028)).toBe(true);
  });

  it('returns false for 2029 (after window)', () => {
    expect(checkSunsetWindow(2029)).toBe(false);
  });

  it('returns false for years well before OBBBA (e.g. 2020)', () => {
    expect(checkSunsetWindow(2020)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// checkTransitionRelief
// ---------------------------------------------------------------------------

describe('checkTransitionRelief', () => {
  it('returns true for 2025 (transition relief year)', () => {
    expect(checkTransitionRelief(2025)).toBe(true);
  });

  it('returns false for 2026 (separate-reporting required)', () => {
    expect(checkTransitionRelief(2026)).toBe(false);
  });

  it('returns false for 2027', () => {
    expect(checkTransitionRelief(2027)).toBe(false);
  });

  it('returns false for 2028', () => {
    expect(checkTransitionRelief(2028)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// isTTOCEligible — all 11 V2.0 codes → true
// ---------------------------------------------------------------------------

describe('isTTOCEligible', () => {
  const eligibleCodes = [
    'wait_staff',
    'bartender_barback',
    'host_busser_runner',
    'rideshare_driver',
    'delivery_driver',
    'taxi_driver',
    'valet_parking',
    'hairstylist_barber',
    'nail_technician',
    'massage_therapist',
    'hotel_concierge_bellhop',
  ];

  for (const code of eligibleCodes) {
    it(`returns true for eligible code: ${code}`, () => {
      expect(isTTOCEligible(code)).toBe(true);
    });
  }

  it('returns false for unknown_code', () => {
    expect(isTTOCEligible('unknown_code')).toBe(false);
  });

  it('returns false for empty string', () => {
    expect(isTTOCEligible('')).toBe(false);
  });

  it('returns false for other_tipped_ttoc_lookup (picker placeholder, not a real code)', () => {
    expect(isTTOCEligible('other_tipped_ttoc_lookup')).toBe(false);
  });

  it('returns false for ineligible_occupation', () => {
    expect(isTTOCEligible('ineligible_occupation')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// computePhaseOutFraction
// ---------------------------------------------------------------------------

describe('computePhaseOutFraction — single filer', () => {
  // single threshold: $150,000 = 15_000_000 cents
  // single full:      $400,000 = 40_000_000 cents

  it('returns 0.0 at exactly the threshold ($150K)', () => {
    const result = computePhaseOutFraction(15_000_000, 'single');
    expect(result).toBe(0);
  });

  it('returns 1.0 at exactly the full phase-out ($400K)', () => {
    const result = computePhaseOutFraction(40_000_000, 'single');
    expect(result).toBe(1);
  });

  it('returns 0.5 at the midpoint ($275K) for single', () => {
    // midpoint = (150K + 400K) / 2 = 275K = 27_500_000 cents
    const result = computePhaseOutFraction(27_500_000, 'single');
    expect(result).toBeCloseTo(0.5, 10);
  });

  it('returns 0 below threshold ($40K MAGI)', () => {
    expect(computePhaseOutFraction(4_000_000, 'single')).toBe(0);
  });

  it('returns 1 above full phase-out ($500K MAGI)', () => {
    expect(computePhaseOutFraction(50_000_000, 'single')).toBe(1);
  });

  it('returns a fraction in (0,1) for MAGI between threshold and full ($200K → 0.2)', () => {
    // $200K: (200K - 150K) / (400K - 150K) = 50K / 250K = 0.2
    const result = computePhaseOutFraction(20_000_000, 'single');
    expect(result).toBeCloseTo(0.2, 10);
  });
});

describe('computePhaseOutFraction — head_of_household (treated as single)', () => {
  it('returns 0.0 at $150K threshold', () => {
    expect(computePhaseOutFraction(15_000_000, 'head_of_household')).toBe(0);
  });

  it('returns 1.0 at $400K full phase-out', () => {
    expect(computePhaseOutFraction(40_000_000, 'head_of_household')).toBe(1);
  });
});

describe('computePhaseOutFraction — married_filing_jointly', () => {
  // joint threshold: $300,000 = 30_000_000 cents
  // joint full:      $550,000 = 55_000_000 cents

  it('returns 0.0 at exactly the joint threshold ($300K)', () => {
    expect(computePhaseOutFraction(30_000_000, 'married_filing_jointly')).toBe(0);
  });

  it('returns 1.0 at exactly the joint full phase-out ($550K)', () => {
    expect(computePhaseOutFraction(55_000_000, 'married_filing_jointly')).toBe(1);
  });

  it('returns 0 below the joint threshold ($40K MAGI)', () => {
    expect(computePhaseOutFraction(4_000_000, 'married_filing_jointly')).toBe(0);
  });
});

describe('computePhaseOutFraction — married_filing_separately', () => {
  // MFS threshold: $150,000 = 15_000_000 cents
  // MFS full:      $275,000 = 27_500_000 cents

  it('returns 0.0 at exactly the MFS threshold ($150K)', () => {
    expect(computePhaseOutFraction(15_000_000, 'married_filing_separately')).toBe(0);
  });

  it('returns 1.0 at exactly the MFS full phase-out ($275K)', () => {
    expect(computePhaseOutFraction(27_500_000, 'married_filing_separately')).toBe(1);
  });

  it('returns 1.0 for MFS at $40K MAGI (below threshold → 0)', () => {
    expect(computePhaseOutFraction(4_000_000, 'married_filing_separately')).toBe(0);
  });
});
