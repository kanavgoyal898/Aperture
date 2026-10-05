"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import * as echarts from "echarts/core";
import { TreemapChart } from "echarts/charts";
import { TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([TreemapChart, TooltipComponent, CanvasRenderer]);

const percent = (value) => Number.isFinite(value) ? `${value >= 0 ? "+" : ""}${value.toFixed(2)}%` : "—";
const compact = (value) => Number.isFinite(value) ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value) : "—";
const money = (value) => Number.isFinite(value) ? new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value) : "—";
const escapeHtml = (value) => String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[character]));

function tileVisual(value, extent, dark) {
  if (!Number.isFinite(value)) return { color: dark ? "#252824" : "#dfded7", text: dark ? "#fffaf2" : "#1d211d" };
  const intensity = Math.min(Math.abs(value) / Math.max(extent, 1), 1);
  const hue = value >= 0 ? 148 : 5;
  const saturation = (dark ? 28 : 20) + intensity * (value >= 0 ? 30 : 40);
  const lightness = dark ? 18 + intensity * 24 : 90 - intensity * 43;
  return {
    color: `hsl(${hue} ${saturation}% ${lightness}%)`,
    text: dark || intensity > .62 ? "#fffaf2" : "#1d211d",
  };
}

export default function PerformanceTreemap({ stocks, period, theme, groupLabel = "watchlist" }) {
  const elementRef = useRef(null);
  const router = useRouter();

  useEffect(() => {
    if (!elementRef.current) return undefined;
    const dark = theme === "dark";
    const extent = Math.max(1, ...stocks.map((stock) => Math.abs(stock.viewedReturn || 0)));
    const chart = echarts.init(elementRef.current, null, { renderer: "canvas" });
    const weights = stocks.map((stock) => stock.marketCap || (stock.price * stock.volume) || 1).filter((value) => value > 0);
    const weightFloor = Math.min(...weights.map(Math.log10));
    const weightCeiling = Math.max(...weights.map(Math.log10));
    const weightSpread = weightCeiling - weightFloor || 1;
    const data = stocks.map((stock) => {
      const marketWeight = stock.marketCap || (stock.price * stock.volume) || 1;
      const visual = tileVisual(stock.viewedReturn, extent, dark);
      return {
        id: stock.ticker,
        name: stock.ticker,
        value: 1 + 1.25 * Math.max(0, Math.log10(Math.max(marketWeight, 1)) - weightFloor) / weightSpread,
        itemStyle: { color: visual.color },
        label: { color: visual.text },
        emphasis: { itemStyle: { color: visual.color } },
        meta: stock,
      };
    });

    chart.setOption({
      animationDurationUpdate: 650,
      animationEasingUpdate: "cubicOut",
      tooltip: {
        confine: true,
        backgroundColor: dark ? "#191c17" : "#171916",
        borderColor: dark ? "#30342e" : "transparent",
        borderWidth: dark ? 1 : 0,
        padding: [11, 13],
        textStyle: { color: dark ? "#f0efe8" : "#fff", fontFamily: "DM Mono, monospace", fontSize: 10 },
        formatter: (params) => {
          const item = Array.isArray(params) ? params[0]?.data : params?.data;
          const stock = item?.meta;
          if (!stock?.ticker) return "";
          return `<div class="treemap-tooltip"><b>${escapeHtml(stock.ticker)}</b><span>${escapeHtml(stock.name)}</span><small>${escapeHtml(stock.assetType)} · ${escapeHtml(stock.sector)}</small><div class="treemap-tooltip-grid"><i>${escapeHtml(period)} return<strong>${escapeHtml(percent(stock.viewedReturn))}</strong></i><i>Last price<strong>${escapeHtml(money(stock.price))}</strong></i><i>Today<strong>${escapeHtml(percent(stock.day))}</strong></i><i>Market cap<strong>${escapeHtml(compact(stock.marketCap))}</strong></i><i>Market<strong>${escapeHtml(stock.market ? `${stock.market.name} ${stock.market.status}` : "Unavailable")}</strong></i><i>Signal<strong>${escapeHtml(Number.isFinite(stock.signal) ? `${stock.signal} / 100` : "—")}</strong></i></div><em>Open focus view</em></div>`;
        },
      },
      series: [{
        type: "treemap",
        roam: false,
        nodeClick: false,
        breadcrumb: { show: false },
        squareRatio: 1,
        sort: "desc",
        visibleMin: 0,
        childrenVisibleMin: 0,
        animationDuration: 700,
        data,
        label: {
          show: true,
          position: "inside",
          align: "center",
          verticalAlign: "middle",
          padding: 6,
          formatter: ({ data: item }) => item?.meta?.ticker ? item.name : "",
          fontFamily: "Newsreader, serif",
          fontSize: 22,
          fontWeight: 500,
        },
        labelLayout: ({ rect }) => {
          const shortestSide = Math.min(rect.width, rect.height);
          const fontSize = shortestSide < 42 ? 10 : shortestSide < 64 ? 12 : shortestSide < 96 ? 15 : shortestSide < 150 ? 19 : 25;
          return { width: Math.max(12, rect.width - 14), height: Math.max(12, rect.height - 14), fontSize, hideOverlap: false };
        },
        upperLabel: { show: false },
        itemStyle: { borderColor: dark ? "#11130f" : "#f2f0e9", borderWidth: 3, gapWidth: 3, borderRadius: 0 },
        emphasis: { focus: "none", scale: false, itemStyle: { borderColor: dark ? "#f0efe8" : "#171916", borderWidth: 2, shadowBlur: 0 }, label: { show: true } },
      }],
    });

    const openTicker = ({ data: item }) => { if (item?.meta?.ticker) router.push(`/focus?ticker=${encodeURIComponent(item.meta.ticker)}`); };
    chart.on("click", openTicker);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(elementRef.current);
    return () => { observer.disconnect(); chart.off("click", openTicker); chart.dispose(); };
  }, [stocks, period, theme, router]);

  const minimumHeight = stocks.length <= 4 ? 280 : stocks.length <= 8 ? 420 : 620;
  const responsiveHeight = Math.min(1100, Math.max(minimumHeight, Math.ceil(stocks.length / 4) * 135));
  return <div ref={elementRef} className="performance-treemap" style={{ "--treemap-height": `${responsiveHeight}px` }} role="img" aria-label={`${period} performance treemap containing ${stocks.length} ${groupLabel} tickers`}/>;
}
