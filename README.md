# no-tax-on-tips-mcp

MCP server exposing the OBBBA "No Tax on Tips" federal deduction logic as callable tools (stdio transport).

## DISCLAIMERS

**1. Informational only — NOT tax advice.**
This tool provides estimates based on publicly available statutory and regulatory information. It is NOT legal or tax advice. Verify all results against IRS guidance at [irs.gov/TippedOccupations](https://www.irs.gov/TippedOccupations) and consult a qualified tax professional before making any tax decision.

**2. Occupation codes are placeholder slugs — NOT validated Treasury codes.**
The TTOC occupation codes in this server (e.g. `"bartender_barback"`) are DESCRIPTIVE PLACEHOLDER SLUGS. They are NOT the validated 3-digit numeric Treasury codes from the IRS final regulations (Federal Register 2026-07104). Operator validation is pending (`reviewed_by_operator_at_utc = 0` in source). Do not use these codes for official filings.

**3. Applies to tax years 2025-2028 only (OBBBA sunset window).**
The OBBBA No-Tax-on-Tips deduction is effective for tax years 2025 through 2028 (inclusive). Per-filing-status caps and MAGI phase-outs apply. Tax year 2025 has transition relief (separate-reporting requirement waived).

**4. module_version: `1.0.0-2026-04-13`**
This matches the IRS final regulations date (Federal Register 2026-07104). If IRS guidance changes, the module version must be updated and cached deduction results invalidated.

---

## Installation

```bash
npm install
npm run build
```

## Running

```bash
npm start
```

Or in development (no build step):

```bash
npm run dev
```

## Testing

```bash
npm test
```

## MCP Client Configuration

Add to your MCP client config (e.g. Claude Desktop `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "no-tax-on-tips": {
      "command": "node",
      "args": ["C:/Users/cruzr/no-tax-on-tips-mcp/dist/index.js"]
    }
  }
}
```

---

## Tools

### `check_tip_deduction_eligibility`

Checks eligibility without computing a dollar amount.

**Input:**
```json
{
  "occupation_code": "wait_staff",
  "magi_usd": 75000,
  "filing_status": "single",
  "tax_year": 2026
}
```

**Output:**
```json
{
  "in_sunset_window": true,
  "transition_relief": false,
  "ttoc_eligible": true,
  "phase_out_fraction": 0,
  "eligible": true,
  "notes": ["..."]
}
```

`eligible = in_sunset_window && ttoc_eligible && phase_out_fraction < 1`

---

### `estimate_tip_deduction`

Full deduction estimate. USD in, USD out. Internal math uses integer cents.

**Input:**
```json
{
  "qualified_tips_usd": 23000,
  "filing_status": "single",
  "tax_year": 2026,
  "magi_usd": 75000
}
```

**Output:**
```json
{
  "qualified_tips_usd": 23000,
  "cap_usd": 25000,
  "phase_out_fraction": 0,
  "deduction_usd": 23000,
  "disclaimer": "..."
}
```

---

### `list_eligible_occupations`

Returns the onboarding picker subset (11 occupation codes + 1 lookup placeholder).

---

### `get_obbba_reference`

Returns caps, phase-out bands, sunset window, module version, source URLs, and disclaimers.

---

## Caps and Phase-Out Bands (2025-2028)

| Filing Status | Cap | Phase-Out Threshold | Full Phase-Out |
|---|---|---|---|
| Single | $25,000 | $150,000 | $400,000 |
| Head of Household | $25,000 | $150,000 | $400,000 |
| Married Filing Jointly | $25,000 | $300,000 | $550,000 |
| Married Filing Separately | $12,500 | $150,000 | $275,000 |

Phase-out is linear: $100 reduction per $1,000 (or fraction) of MAGI over threshold.

---

## Source

Tax logic copied verbatim from `nightshift-v2/src/features/tax-engine/jurisdictions/us-fed/deductions/obbba-no-tax-on-tips/` (read-only source). No formulas were re-derived. Import paths adjusted for this standalone package; no other modifications.

**Source references:**
- IRS Tipped Occupations: https://www.irs.gov/TippedOccupations
- Federal Register 2026-07104: https://www.federalregister.gov/documents/2026/04/13/2026-07104/occupations-that-customarily-and-regularly-received-tips-definition-of-qualified-tips

---

## Publishing

Do NOT publish to npm or push to a remote without operator sign-off. This is a local build only. Publishing is a separate operator step.
