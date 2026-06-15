/**
 * no-tax-on-tips-mcp — MCP server exposing OBBBA No-Tax-on-Tips deduction logic
 *
 * Tools:
 *   check_tip_deduction_eligibility  — eligibility check without a dollar amount
 *   estimate_tip_deduction           — full deduction estimate (USD in, USD out), GATED on occupation
 *   list_eligible_occupations        — the onboarding picker subset
 *   get_obbba_reference              — caps, phase-out bands, sunset window, module version
 *
 * Transport: stdio (MCP standard). Pure tool logic lives in ./tools.ts (testable
 * without a transport); this file is server wiring only.
 *
 * DISCLAIMERS (see README.md for full text):
 *   1. Informational only — NOT tax advice. Verify with IRS (irs.gov/TippedOccupations)
 *      and a qualified tax professional before making any tax decision.
 *   2. Occupation codes are DESCRIPTIVE PLACEHOLDER SLUGS, not the validated 3-digit
 *      numeric Treasury codes from IRS final regs (Federal Register 2026-07104).
 *      Operator validation pending (reviewed_by_operator_at_utc = 0 in source).
 *   3. Applies to tax years 2025-2028 (OBBBA sunset). Per-filing-status caps and
 *      MAGI phase-outs apply.
 *   4. module_version: "1.0.0-2026-04-13" (matches IRS final regs date).
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import {
  DISCLAIMER_SHORT,
  checkEligibility,
  estimateDeduction,
  listEligibleOccupations,
  getObbbaReference,
} from './tools.js';

const FILING_STATUSES = [
  'single',
  'head_of_household',
  'married_filing_jointly',
  'married_filing_separately',
] as const;

const FilingStatusSchema = z.enum(FILING_STATUSES);

const CheckEligibilitySchema = z.object({
  occupation_code: z
    .string()
    .min(1)
    .describe(
      'TTOC occupation code (descriptive slug, e.g. "bartender_barback"). ' +
      'Use list_eligible_occupations to see valid codes.',
    ),
  magi_usd: z.number().nonnegative().describe('Modified Adjusted Gross Income in US dollars (e.g. 75000 for $75,000).'),
  filing_status: FilingStatusSchema.describe(
    'Filing status: single | head_of_household | married_filing_jointly | married_filing_separately',
  ),
  tax_year: z.number().int().min(2020).max(2035).describe('Tax year as integer (e.g. 2026).'),
});

const EstimateDeductionSchema = z.object({
  qualified_tips_usd: z
    .number()
    .nonnegative()
    .describe('Net qualified tip income in US dollars (after tip-out, before cap). E.g. 23000 for $23,000.'),
  occupation_code: z
    .string()
    .min(1)
    .describe(
      'TTOC occupation code (descriptive slug, e.g. "bartender_barback"). REQUIRED — the estimate is ' +
      'gated on occupation eligibility. Use list_eligible_occupations to see valid codes.',
    ),
  filing_status: FilingStatusSchema.describe(
    'Filing status: single | head_of_household | married_filing_jointly | married_filing_separately',
  ),
  tax_year: z.number().int().min(2020).max(2035).describe('Tax year as integer (e.g. 2026).'),
  magi_usd: z.number().nonnegative().describe('Modified Adjusted Gross Income in US dollars (e.g. 75000 for $75,000).'),
});

const server = new Server(
  { name: 'no-tax-on-tips-mcp', version: '1.1.0' },
  { capabilities: { tools: {} } },
);

function asContent(obj: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(obj, null, 2) }] };
}

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'check_tip_deduction_eligibility',
      description:
        'Checks whether a tipped worker is eligible for the OBBBA No-Tax-on-Tips federal deduction, ' +
        'without computing a dollar amount. Returns sunset-window status, transition relief, TTOC ' +
        'occupation eligibility, MAGI phase-out fraction, and an overall eligible flag. ' +
        DISCLAIMER_SHORT,
      inputSchema: {
        type: 'object',
        properties: {
          occupation_code: {
            type: 'string',
            description:
              'TTOC occupation code (descriptive slug, e.g. "bartender_barback"). ' +
              'Use list_eligible_occupations to see valid codes.',
          },
          magi_usd: { type: 'number', description: 'Modified Adjusted Gross Income in US dollars (e.g. 75000 for $75,000).' },
          filing_status: {
            type: 'string',
            enum: [...FILING_STATUSES],
            description: 'Filing status: single | head_of_household | married_filing_jointly | married_filing_separately',
          },
          tax_year: { type: 'integer', description: 'Tax year as integer (e.g. 2026).' },
        },
        required: ['occupation_code', 'magi_usd', 'filing_status', 'tax_year'],
      },
    },
    {
      name: 'estimate_tip_deduction',
      description:
        'Estimates the OBBBA No-Tax-on-Tips deduction. REQUIRES occupation_code and routes through the ' +
        'same applyDeduction the app uses, so the estimate is gated on TTOC occupation eligibility, the ' +
        '2025-2028 sunset window, and MAGI phase-out: an ineligible occupation, out-of-window year, or ' +
        'fully phased-out MAGI returns deduction_usd 0 with a populated reason_if_zero. Inputs/outputs in ' +
        'US dollars; internal math in integer cents. Returns: qualifies, occupation_code_eligible, ' +
        'deduction_usd, capped_qualified_tips_usd, cap_usd, phase_out_fraction, reason_if_zero. ' +
        DISCLAIMER_SHORT,
      inputSchema: {
        type: 'object',
        properties: {
          qualified_tips_usd: {
            type: 'number',
            description: 'Net qualified tip income in US dollars (after tip-out, before cap). E.g. 23000 for $23,000.',
          },
          occupation_code: {
            type: 'string',
            description:
              'TTOC occupation code (descriptive slug, e.g. "bartender_barback"). REQUIRED — estimate is ' +
              'gated on occupation eligibility.',
          },
          filing_status: {
            type: 'string',
            enum: [...FILING_STATUSES],
            description: 'Filing status: single | head_of_household | married_filing_jointly | married_filing_separately',
          },
          tax_year: { type: 'integer', description: 'Tax year as integer (e.g. 2026).' },
          magi_usd: { type: 'number', description: 'Modified Adjusted Gross Income in US dollars (e.g. 75000 for $75,000).' },
        },
        required: ['qualified_tips_usd', 'occupation_code', 'filing_status', 'tax_year', 'magi_usd'],
      },
    },
    {
      name: 'list_eligible_occupations',
      description:
        'Returns the onboarding picker subset of TTOC-eligible occupations plus the placeholder-slug caveat. ' +
        DISCLAIMER_SHORT,
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'get_obbba_reference',
      description:
        'Returns the full OBBBA reference data: per-filing-status caps, MAGI phase-out bands, ' +
        'sunset window (2025-2028), module version, and source URLs. ' +
        DISCLAIMER_SHORT,
      inputSchema: { type: 'object', properties: {}, required: [] },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'check_tip_deduction_eligibility') {
    const r = checkEligibility(CheckEligibilitySchema.parse(args));
    return asContent({ ...r, disclaimer: DISCLAIMER_SHORT });
  }

  if (name === 'estimate_tip_deduction') {
    const r = estimateDeduction(EstimateDeductionSchema.parse(args));
    return asContent({ ...r, disclaimer: DISCLAIMER_SHORT });
  }

  if (name === 'list_eligible_occupations') {
    return asContent(listEligibleOccupations());
  }

  if (name === 'get_obbba_reference') {
    return asContent(getObbbaReference());
  }

  throw new Error(`Unknown tool: ${name}`);
});

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Server runs until process exit — stdio transport handles lifecycle
}

main().catch((err) => {
  process.stderr.write(`Fatal error: ${String(err)}\n`);
  process.exit(1);
});
