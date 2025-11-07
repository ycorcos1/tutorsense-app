"use client";

import React, { useMemo } from "react";

type PerformanceTrendChartProps = {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  className?: string;
};

export default function PerformanceTrendChart({
  data,
  width = 420,
  height = 200,
  stroke = "#2563eb",
  fill = "#dbeafe",
  className,
}: PerformanceTrendChartProps) {
  const normalizedData = data ?? [];

  const chartData = useMemo(() => {
    if (!Array.isArray(normalizedData) || normalizedData.length === 0) {
      const fallbackPadding = 40;
      const fallbackChartWidth = Math.max(0, width - fallbackPadding * 2);
      const fallbackChartHeight = Math.max(0, height - fallbackPadding * 2);
      return {
        points: [],
        min: 0,
        max: 100,
        range: 100,
        startValue: 0,
        endValue: 0,
        trend: "stable" as const,
        padding: fallbackPadding,
        chartWidth: fallbackChartWidth,
        chartHeight: fallbackChartHeight,
      };
    }

    const min = Math.min(...normalizedData);
    const max = Math.max(...normalizedData);
    const range = max - min || 1;
    const startValue = normalizedData[0];
    const endValue = normalizedData[normalizedData.length - 1];
    const trendDelta = endValue - startValue;

    let trend: "improving" | "declining" | "stable" = "stable";
    if (trendDelta > 3) {
      trend = "improving";
    } else if (trendDelta < -3) {
      trend = "declining";
    }

    const padding = 40;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    const step =
      normalizedData.length > 1
        ? chartWidth / (normalizedData.length - 1)
        : chartWidth;

    const points = normalizedData.map((value, index) => {
      const x =
        padding + (normalizedData.length > 1 ? step * index : chartWidth / 2);
      const scaledValue = (value - min) / range;
      const y = padding + chartHeight - scaledValue * chartHeight;
      return {
        x: Number.isFinite(x) ? x : padding,
        y: Number.isFinite(y) ? y : padding + chartHeight / 2,
        value,
      };
    });

    return {
      points,
      min,
      max,
      range,
      startValue,
      endValue,
      trend,
      padding,
      chartWidth,
      chartHeight,
    };
  }, [normalizedData, width, height]);

  const yAxisTicks = useMemo(() => {
    const { min, max, range, padding, chartHeight } = chartData;
    const tickCount = 5;
    const ticks: Array<{ y: number; value: number }> = [];

    for (let i = 0; i <= tickCount; i++) {
      const tickValue = min + (range / tickCount) * i;
      const scaledValue = (tickValue - min) / (range || 1);
      const y = padding + chartHeight - scaledValue * chartHeight;
      ticks.push({
        y: Number.isFinite(y) ? y : padding + chartHeight / 2,
        value: Math.round(tickValue),
      });
    }

    return ticks;
  }, [chartData]);

  const xAxisLabels = useMemo(() => {
    if (normalizedData.length === 0) {
      return [];
    }

    const labels: Array<{ x: number; label: string }> = [];
    const { padding, chartWidth } = chartData;
    const step =
      normalizedData.length > 1
        ? chartWidth / (normalizedData.length - 1)
        : chartWidth;

    for (let i = 0; i < normalizedData.length; i++) {
      const x =
        padding + (normalizedData.length > 1 ? step * i : chartWidth / 2);
      const dayNumber = i + 1;
      labels.push({
        x: Number.isFinite(x) ? x : padding,
        label: `Day ${dayNumber}`,
      });
    }

    return labels;
  }, [normalizedData, chartData]);

  if (normalizedData.length === 0) {
    return (
      <div
        className={`rounded-lg border border-gray-200 bg-gray-50 p-4 ${className}`}
      >
        <p className="text-sm text-gray-500">No trend data available.</p>
      </div>
    );
  }

  const { points, min, max, startValue, endValue, trend, padding } = chartData;

  const linePath =
    points.length > 0
      ? points
          .map(
            (point, index) => `${index === 0 ? "M" : "L"} ${point.x} ${point.y}`
          )
          .join(" ")
      : "";

  const areaPath =
    linePath && points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${
          height - padding
        } L ${padding} ${height - padding} Z`
      : "";

  const trendDescription = useMemo(() => {
    if (trend === "improving") {
      return `Score improved from ${startValue} to ${endValue} (+${
        endValue - startValue
      } points)`;
    }
    if (trend === "declining") {
      return `Score declined from ${startValue} to ${endValue} (${
        endValue - startValue
      } points)`;
    }
    return `Score remained relatively stable (${startValue} → ${endValue})`;
  }, [trend, startValue, endValue]);

  const trendColor =
    trend === "improving"
      ? "text-green-700"
      : trend === "declining"
      ? "text-red-700"
      : "text-gray-700";

  return (
    <div className={`space-y-3 ${className}`}>
      <div className="rounded-lg border border-gray-200 bg-white p-4">
        <div className="mb-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-sm font-semibold text-gray-900">
              Daily Score Trend
            </p>
            <p className="text-xs font-medium text-gray-500">
              Range: {min} - {max}
            </p>
          </div>
          <p className={`text-sm font-semibold ${trendColor}`}>
            {trendDescription}
          </p>
        </div>

        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          className="overflow-visible"
          role="img"
          aria-label={`Performance trend showing scores from ${min} to ${max}`}
        >
          {/* Grid lines */}
          {yAxisTicks.map((tick, index) => {
            if (index === 0 || index === yAxisTicks.length - 1) {
              return null;
            }
            return (
              <line
                key={`grid-${index}`}
                x1={padding}
                y1={tick.y}
                x2={width - padding}
                y2={tick.y}
                stroke="#e5e7eb"
                strokeWidth={1}
                strokeDasharray="2,2"
              />
            );
          })}

          {/* Area fill */}
          {areaPath && (
            <path d={areaPath} fill={fill} fillOpacity={0.3} stroke="none" />
          )}

          {/* Line */}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={stroke}
              strokeWidth={3}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Data points */}
          {points.map((point, index) => (
            <circle
              key={`point-${index}`}
              cx={point.x}
              cy={point.y}
              r={4}
              fill={stroke}
              stroke="white"
              strokeWidth={2}
            />
          ))}

          {/* Y-axis */}
          <line
            x1={padding}
            y1={padding}
            x2={padding}
            y2={height - padding}
            stroke="#6b7280"
            strokeWidth={2}
          />

          {/* X-axis */}
          <line
            x1={padding}
            y1={height - padding}
            x2={width - padding}
            y2={height - padding}
            stroke="#6b7280"
            strokeWidth={2}
          />

          {/* Y-axis labels */}
          {yAxisTicks.map((tick, index) => (
            <g key={`y-tick-${index}`}>
              <line
                x1={padding - 5}
                y1={tick.y}
                x2={padding}
                y2={tick.y}
                stroke="#6b7280"
                strokeWidth={1}
              />
              <text
                x={padding - 10}
                y={tick.y + 4}
                textAnchor="end"
                className="text-xs fill-gray-600"
                fontSize="11"
              >
                {tick.value}
              </text>
            </g>
          ))}

          {/* X-axis labels */}
          {xAxisLabels.map((label, index) => {
            if (normalizedData.length > 7 && index % 2 !== 0) {
              return null;
            }
            return (
              <text
                key={`x-label-${index}`}
                x={label.x}
                y={height - padding + 20}
                textAnchor="middle"
                className="text-xs fill-gray-600"
                fontSize="11"
              >
                {label.label}
              </text>
            );
          })}
        </svg>

        <div className="mt-3 flex items-center justify-between border-t border-gray-200 pt-2 text-xs text-gray-500">
          <span className="font-medium">Y-axis: Score (0-100 scale)</span>
          <span className="font-medium">
            X-axis: Days (most recent on right)
          </span>
        </div>
      </div>

      {trend === "improving" && endValue < 60 && (
        <div className="rounded-md border border-blue-200 bg-blue-50/60 px-3 py-2 text-sm text-blue-800">
          <p className="font-semibold">Note:</p>
          <p>
            While the score is improving, it remains below the at-risk threshold
            (60). Continue monitoring to ensure sustained improvement.
          </p>
        </div>
      )}

      {trend === "declining" && startValue >= 60 && (
        <div className="rounded-md border border-amber-200 bg-amber-50/60 px-3 py-2 text-sm text-amber-800">
          <p className="font-semibold">Warning:</p>
          <p>
            Score is declining from a previously acceptable level. Investigate
            recent changes that may have caused this drop.
          </p>
        </div>
      )}
    </div>
  );
}
