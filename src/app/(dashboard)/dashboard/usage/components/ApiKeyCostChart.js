"use client";

import PropTypes from "prop-types";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import Card from "@/shared/components/Card";
import {
  buildApiKeyCostRows,
  formatCompactNumber,
  formatCost,
  formatLastUsed,
} from "./apiKeyCostData";

function TooltipContent({ active, payload }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;

  return (
    <div className="rounded-lg border border-border bg-bg px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 max-w-[220px] truncate font-semibold text-text-main">{row.keyName}</div>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-1">
        <span className="text-text-muted">Cost</span>
        <span className="text-right font-medium text-warning">{formatCost(row.cost)}</span>
        <span className="text-text-muted">Tokens</span>
        <span className="text-right">{formatCompactNumber(row.totalTokens)}</span>
        <span className="text-text-muted">Requests</span>
        <span className="text-right">{formatCompactNumber(row.requests)}</span>
        <span className="text-text-muted">Last used</span>
        <span className="text-right">{formatLastUsed(row.lastUsed)}</span>
      </div>
    </div>
  );
}

TooltipContent.propTypes = {
  active: PropTypes.bool,
  payload: PropTypes.array,
};

export default function ApiKeyCostChart({ byApiKey }) {
  const rows = buildApiKeyCostRows(byApiKey);
  const hasData = rows.length > 0;

  return (
    <Card className="flex min-w-0 flex-col gap-3 p-3 sm:p-4">
      <div className="flex min-w-0 flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h3 className="text-sm font-semibold uppercase text-text-muted">Top API Keys by Cost</h3>
        {hasData && (
          <span className="text-xs text-text-muted">Sorted by estimated cost</span>
        )}
      </div>

      {!hasData ? (
        <div className="flex h-48 items-center justify-center text-sm text-text-muted">
          No API key usage recorded yet.
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={Math.max(220, rows.length * 38)}>
          <BarChart
            data={rows}
            layout="vertical"
            margin={{ top: 4, right: 16, left: 12, bottom: 4 }}
          >
            <CartesianGrid strokeDasharray="3 3" strokeOpacity={0.1} horizontal={false} />
            <XAxis
              type="number"
              tick={{ fontSize: 10, fill: "currentColor", fillOpacity: 0.5 }}
              tickLine={false}
              axisLine={false}
              tickFormatter={formatCost}
            />
            <YAxis
              type="category"
              dataKey="keyName"
              width={150}
              tick={{ fontSize: 11, fill: "currentColor", fillOpacity: 0.7 }}
              tickLine={false}
              axisLine={false}
              interval={0}
            />
            <Tooltip content={<TooltipContent />} cursor={{ fill: "var(--color-bg-subtle)" }} />
            <Bar dataKey="cost" fill="#f59e0b" radius={[0, 4, 4, 0]} barSize={18} />
          </BarChart>
        </ResponsiveContainer>
      )}
    </Card>
  );
}

ApiKeyCostChart.propTypes = {
  byApiKey: PropTypes.object,
};
