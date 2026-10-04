"use client";
import { useEffect, useRef } from "react";
import {
  createChart,
  ColorType,
  HistogramSeries,
  LineSeries,
  CandlestickSeries,
  createSeriesMarkers,
  type ISeriesApi,
  type SeriesType,
  type Time,
} from "lightweight-charts";
import { visibleTriggerEvents } from "@/lib/client/event-charts";
import type { Bar, GapEvent } from "@/lib/domain/types";
export function MarketChart({
  points,
  histogram = false,
  label,
  bars,
  mode = "line",
  reference,
  event,
  events,
}: {
  points: { time: string; value: number }[];
  histogram?: boolean;
  label: string;
  bars?: Bar[];
  mode?: "line" | "candles";
  reference?: number | null;
  event?: Pick<GapEvent, "firstTrigger" | "threshold">;
  events?: Pick<GapEvent, "firstTrigger" | "threshold">[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ref.current || !(bars?.length || points.length)) return;
    const chart = createChart(ref.current, {
      autoSize: true,
      height: 300,
      layout: {
        background: { type: ColorType.Solid, color: "#11151a" },
        textColor: "#7f8a99",
        fontSize: 12,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "#1c232c" },
        horzLines: { color: "#1c232c" },
      },
      rightPriceScale: { borderColor: "#28313c" },
      timeScale: {
        borderColor: "#28313c",
        timeVisible: !histogram,
        secondsVisible: false,
        lockVisibleTimeRangeOnResize: true,
        minBarSpacing: events ? 0.001 : 0.5,
        tickMarkFormatter: (time: Time, tickMarkType: number) => {
          const date =
            typeof time === "number"
              ? new Date(time * 1000)
              : typeof time === "string"
                ? new Date(time)
                : new Date(Date.UTC(time.year, time.month - 1, time.day, 12));
          return new Intl.DateTimeFormat(
            "en-US",
            histogram || (events && tickMarkType < 3)
              ? { timeZone: "America/New_York", month: "short", day: "numeric" }
              : {
                  timeZone: "America/New_York",
                  hour: "2-digit",
                  minute: "2-digit",
                  hour12: false,
                },
          ).format(date);
        },
      },
      localization: {
        timeFormatter: (time: number | string) =>
          new Intl.DateTimeFormat("en-US", {
            timeZone: "America/New_York",
            month: "short",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
          }).format(new Date(typeof time === "number" ? time * 1000 : time)),
      },
    });
    const sorted = [
      ...(bars ? bars.map((b) => ({ time: b.t, value: b.c })) : points),
    ].sort((a, b) => a.time.localeCompare(b.time));
    const data = sorted.map((p) => ({
      time: (Date.parse(p.time) / 1000) as Time,
      value: p.value,
      color: p.value >= 0 ? "#469e88" : "#b96870",
    }));
    function annotate(series: ISeriesApi<SeriesType, Time>) {
      if (reference != null)
        series.createPriceLine({
          price: reference,
          color: "#8290a0",
          lineWidth: 1,
          lineStyle: 2,
          title: "Prior close",
        });
      if (event)
        series.createPriceLine({
          price: event.firstTrigger.thresholdPrice,
          color: "#d5b673",
          lineWidth: 1,
          lineStyle: 2,
          title: `Min gap ${event.firstTrigger.side === "up" ? "+" : "−"}${event.threshold}%`,
        });
      const qualifying = events ?? (event ? [event] : []);
      createSeriesMarkers(
        series,
        visibleTriggerEvents(
          qualifying,
          sorted.map((p) => p.time),
        ).map((e) => ({
          time: (Date.parse(e.firstTrigger.time) / 1000) as Time,
          position:
            e.firstTrigger.side === "up"
              ? ("belowBar" as const)
              : ("aboveBar" as const),
          shape:
            e.firstTrigger.side === "up"
              ? ("arrowUp" as const)
              : ("arrowDown" as const),
          color: "#d5b673",
          text: events
            ? `${e.firstTrigger.side === "up" ? "+" : "−"}${e.threshold}%`
            : `Min gap ${e.firstTrigger.side === "up" ? "+" : "−"}${e.threshold}% · $${e.firstTrigger.thresholdPrice.toFixed(2)}`,
        })),
      );
    }

    if (mode === "candles" && bars) {
      const series = chart.addSeries(CandlestickSeries, {
        upColor: "#469e88",
        downColor: "#b96870",
        borderVisible: false,
        wickUpColor: "#469e88",
        wickDownColor: "#b96870",
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      });
      series.setData(
        [...bars]
          .sort((a, b) => a.t.localeCompare(b.t))
          .map((b) => ({
            time: (Date.parse(b.t) / 1000) as Time,
            open: b.o,
            high: b.h,
            low: b.l,
            close: b.c,
          })),
      );
      annotate(series);
    } else if (histogram)
      chart
        .addSeries(HistogramSeries, {
          priceFormat: {
            type: "custom",
            formatter: (v: number) => `${v.toFixed(2)}%`,
          },
        })
        .setData(data);
    else {
      const series = chart.addSeries(LineSeries, {
        color: "#83abbe",
        lineWidth: 1,
        priceLineVisible: false,
        pointMarkersVisible: true,
        pointMarkersRadius: 2,
        priceFormat: { type: "price", precision: 2, minMove: 0.01 },
      });
      const withGaps: Array<{ time: Time; value?: number }> = [];
      data.forEach((p, i) => {
        if (i && Number(p.time) - Number(data[i - 1].time) > 60)
          withGaps.push({ time: (Number(data[i - 1].time) + 60) as Time });
        withGaps.push(p);
      });
      series.setData(withGaps);
      annotate(series);
    }
    const updateVisibleRange = () => {
      const range = chart.timeScale().getVisibleRange();
      ref.current?.parentElement?.setAttribute(
        "data-all-events-visible",
        String(
          Boolean(
            range &&
            Number(range.from) <= Number(data[0]?.time) &&
            Number(range.to) >= Number(data.at(-1)?.time),
          ),
        ),
      );
    };
    chart.timeScale().subscribeVisibleTimeRangeChange(updateVisibleRange);
    chart.timeScale().fitContent();
    const frame = requestAnimationFrame(updateVisibleRange);
    return () => {
      cancelAnimationFrame(frame);
      chart.remove();
    };
  }, [points, histogram, bars, mode, reference, event, events]);
  return (
    <div
      className="chart-box"
      role="img"
      aria-label={label}
      data-trigger-count={
        visibleTriggerEvents(
          events ?? (event ? [event] : []),
          bars?.map((b) => b.t) ?? points.map((p) => p.time),
        ).length
      }
    >
      {bars?.length || points.length ? (
        <div ref={ref} style={{ height: 300, width: "100%" }} />
      ) : (
        <div className="chart-empty">No eligible observations to chart</div>
      )}
    </div>
  );
}
