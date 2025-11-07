"use client";

import React, { useMemo } from "react";

type SparklineProps = {
  data: number[];
  width?: number;
  height?: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
  className?: string;
};

type SparklineRenderData = {
  linePath: string;
  areaPath?: string;
};

function buildPaths(
  points: Array<{ x: number; y: number }>,
  width: number,
  height: number,
  fill: string
): SparklineRenderData {
  if (points.length === 0) {
    return { linePath: "" };
  }

  if (points.length === 1) {
    const [{ y }] = points;
    const linePath = `M 0 ${y} L ${width} ${y}`;
    if (fill === "none") {
      return { linePath };
    }
    const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
    return { linePath, areaPath };
  }

  const segments = points.map((point, index) => {
    const prefix = index === 0 ? "M" : "L";
    return `${prefix} ${point.x} ${point.y}`;
  });

  const linePath = segments.join(" ");

  if (fill === "none") {
    return { linePath };
  }

  const areaPath = `${linePath} L ${width} ${height} L 0 ${height} Z`;
  return { linePath, areaPath };
}

export default function Sparkline({
  data,
  width = 96,
  height = 32,
  stroke = "#2563eb",
  strokeWidth = 2,
  fill = "none",
  className,
}: SparklineProps) {
  const normalizedData = data ?? [];

  const renderData = useMemo(() => {
    if (!Array.isArray(normalizedData) || normalizedData.length === 0) {
      return { linePath: "" };
    }

    const min = Math.min(...normalizedData);
    const max = Math.max(...normalizedData);
    const range = max - min || 1;
    const step =
      normalizedData.length > 1 ? width / (normalizedData.length - 1) : width;

    const points = normalizedData.map((value, index) => {
      const x = normalizedData.length > 1 ? step * index : width / 2;
      const scaledValue = (value - min) / range;
      const y = height - scaledValue * height;
      return {
        x: Number.isFinite(x) ? x : 0,
        y: Number.isFinite(y) ? y : height / 2,
      };
    });

    return buildPaths(points, width, height, fill);
  }, [fill, height, normalizedData, width]);

  const svgProps = {
    width,
    height,
    viewBox: `0 0 ${width} ${height}`,
    preserveAspectRatio: "none" as const,
    className,
    role: "img" as const,
    "aria-hidden": normalizedData.length === 0 ? true : undefined,
  };

  if (!renderData.linePath) {
    return (
      <svg {...svgProps}>
        <rect
          x="0"
          y={height / 2 - 1}
          width={width}
          height="2"
          fill="#e5e7eb"
        />
      </svg>
    );
  }

  return (
    <svg {...svgProps}>
      {renderData.areaPath ? (
        <path d={renderData.areaPath} fill={fill} stroke="none" />
      ) : null}
      <path
        d={renderData.linePath}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
