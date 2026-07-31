# API Key Cost Chart Design

## Context

The Usage & Analytics overview already fetches aggregate statistics from `/api/usage/stats?period=...` through `UsageStats`. The backend response includes `byApiKey`, where each API key entry tracks requests, prompt tokens, completion tokens, cached tokens, estimated cost, model, provider, key name, masked key, and last-used time.

The existing overview also includes:

- Summary cards for total requests, token totals, and estimated cost.
- Provider topology and recent requests.
- A token/cost time-series chart.
- A table that can switch to "Usage by API Key".

The new chart should make the highest-spending API key visible without requiring the user to switch the table view or inspect rows manually.

## Goal

Add a standalone chart to `Usage & Analytics > Overview` that shows which API keys have the highest estimated cost for the selected period.

The default ranking metric is estimated cost, not token count or request count.

## Non-Goals

- Do not add a new database table or schema migration.
- Do not add a new API route unless the existing `/api/usage/stats` response becomes insufficient during implementation.
- Do not change how usage is tracked or how estimated cost is calculated.
- Do not replace the existing API key usage table.

## UX Design

Add a new card titled `Top API Keys by Cost` below the overview summary cards and above the provider topology section.

Use a horizontal bar chart so key names remain readable and the largest spenders are easy to compare. Show the top 8 API keys by estimated cost. The selected period from the existing period control applies to this chart automatically because it uses the same `stats` payload as the rest of `UsageStats`.

Each row should show:

- API key display name.
- Estimated cost.
- A horizontal cost bar scaled against the highest cost in the current top list.

The tooltip should include:

- Estimated cost.
- Total tokens.
- Requests.
- Last used.

If usage exists without an API key, show it as `Local (No API Key)` as a normal row. If there is no API key usage in the selected period, show an empty state: `No API key usage recorded yet.`

## Data Flow

1. `UsageStats` fetches `/api/usage/stats?period=${period}` as it does today.
2. The new chart receives `stats.byApiKey`.
3. A small transform groups rows by `keyName`.
4. Each group accumulates:
   - `cost`
   - `requests`
   - `promptTokens`
   - `completionTokens`
   - `cachedTokens`
   - `lastUsed`
5. The chart computes `totalTokens = promptTokens + completionTokens`.
6. Rows are sorted by `cost` descending and sliced to the top 8.

This avoids a new backend contract and keeps the chart consistent with the API key table.

## Component Design

Create a focused chart component at:

`src/app/(dashboard)/dashboard/usage/components/ApiKeyCostChart.js`

Responsibilities:

- Accept `byApiKey` as a prop.
- Transform and sort the API key aggregate data.
- Render loading/empty/data states through the parent loading flow.
- Keep chart rendering responsive for desktop and mobile.

`UsageStats` will import and render the component after `OverviewCards`.

## Error Handling

The chart should not perform its own network request, so fetch failures remain handled by `UsageStats`.

If entries are malformed or missing numeric values, treat missing values as zero. If an entry is missing `keyName`, use `apiKeyMasked`, then `apiKeyKey`, then `Unknown API Key`.

## Testing And Verification

Implementation should include at least one focused test for the data transform if the transform is exported or easy to isolate.

Manual verification should cover:

- Period switch updates the chart.
- Highest estimated-cost key appears first.
- Empty state appears when `byApiKey` is empty.
- Long API key names do not overflow on mobile.
- `Local (No API Key)` appears when local usage is present.

Run the relevant lint/typecheck command available in this repo before marking implementation complete.

## Approved Decisions

- Chart placement: standalone chart below overview cards.
- Ranking metric: estimated cost.
- Backend strategy: reuse existing `stats.byApiKey` data.
- Display scope: top 8 API keys for the selected period.
