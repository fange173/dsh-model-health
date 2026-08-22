import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { useEffect, useId, useLayoutEffect, useMemo, useState, useRef } from "react";
import { createPortal } from "react-dom";
import {
  IconChevronDownOutline14,
  IconCloseOutline16,
  IconRefreshOutline14,
  IconSettingsOutline14,
  StateDot
} from "@deepseek-ai/dsh-client-ui-primitives";
import {
  aggregateTone,
  buildRoundSeries,
  buildTrendSeries,
  filterTrendSeries,
  formatLatency,
  formatTimestamp,
  groupByProvider,
  modelEnabled,
  providerEnabled,
  PROBE_TIMEOUT_CODE,
  recency,
  resultTone,
  summarize,
  toggleModel,
  toggleProvider,
  TREND_DOT_CAP
} from "./view.js";
import { MAX_REFRESH_SECONDS } from "./controller.js";
import css from "./ModelHealthAction.module.css";
const REFRESH_CHOICES = [0, 30, 60, 120, 300];
function recencyLabel(health, t) {
  switch (health.kind) {
    case "none":
      return t("recency.none");
    case "justNow":
      return t("recency.justNow");
    case "minutes":
      return t("recency.minutes", { minutes: health.minutes });
    /* v8 ignore next -- hours-only branch reached by long-idle views */
    case "hours":
      return t("recency.hours", { hours: health.hours });
  }
}
function pointTitle(point, t, checkedLabel) {
  const status = point.ok ? `${t("history.ok")} ${formatLatency(point.totalMs)}` : point.code === PROBE_TIMEOUT_CODE ? t("history.timeout") : t("history.failed", { code: point.code });
  return t("history.title", { checkedAt: checkedLabel, status });
}
function ModelRow({ model, t }) {
  const latency = formatLatency(model.ok ? model.totalMs : null);
  const detail = model.ok ? t("latency.title", { ttft: formatLatency(model.ttftMs), total: formatLatency(model.totalMs) }) : `${model.error?.code ?? "unknown"}${model.error?.status !== void 0 ? ` (${model.error.status})` : ""}`;
  return /* @__PURE__ */ jsxs("li", { className: model.ok ? css.row : `${css.row} ${css.rowFailing}`, children: [
    /* @__PURE__ */ jsx(StateDot, { state: resultTone(model), className: css.rowDot }),
    /* @__PURE__ */ jsx("span", { className: css.name, title: model.model, children: model.name }),
    /* @__PURE__ */ jsx("span", { className: css.modelId, title: model.model, children: model.model }),
    /* @__PURE__ */ jsx("span", { className: model.ok ? css.latency : css.errorText, title: model.ok ? detail : model.error?.message ?? detail, children: model.ok ? latency : model.error?.code ?? "unknown" })
  ] });
}
function StatusBoard({ models, t }) {
  const groups = useMemo(() => groupByProvider(models), [models]);
  return /* @__PURE__ */ jsx("div", { className: css.list, children: groups.map((group) => /* @__PURE__ */ jsxs("section", { className: css.providerGroup, children: [
    /* @__PURE__ */ jsxs("header", { className: css.providerHead, children: [
      /* @__PURE__ */ jsx("span", { className: css.providerName, children: group.provider }),
      /* @__PURE__ */ jsx("span", { className: css.providerCount, children: t("provider.count", { count: group.models.length }) })
    ] }),
    /* @__PURE__ */ jsx("ul", { className: css.providerRows, children: group.models.map((model) => /* @__PURE__ */ jsx(ModelRow, { model, t }, `${model.provider}/${model.model}`)) })
  ] }, group.provider)) });
}
function EditableStatusBoard({
  catalog,
  filter,
  onChange,
  t
}) {
  const groups = useMemo(() => groupByProviderList(catalog), [catalog]);
  if (catalog.length === 0) {
    return /* @__PURE__ */ jsx("p", { className: css.emptyNote, children: t("summary.none") });
  }
  return /* @__PURE__ */ jsx("div", { className: css.list, children: groups.map((group) => /* @__PURE__ */ jsxs("section", { className: css.providerGroup, children: [
    /* @__PURE__ */ jsxs("header", { className: css.providerHead, children: [
      /* @__PURE__ */ jsxs("label", { className: css.checkRow, children: [
        /* @__PURE__ */ jsx(
          "input",
          {
            type: "checkbox",
            checked: providerEnabled(filter, group.provider),
            onChange: () => {
              onChange(toggleProvider(filter, group.provider));
            }
          }
        ),
        /* @__PURE__ */ jsx("span", { className: css.providerName, children: group.provider })
      ] }),
      /* @__PURE__ */ jsx("span", { className: css.providerCount, children: t("provider.count", { count: group.entries.length }) })
    ] }),
    /* @__PURE__ */ jsx("ul", { className: css.providerRows, children: group.entries.map((entry) => /* @__PURE__ */ jsx("li", { className: css.catalogRow, children: /* @__PURE__ */ jsxs("label", { className: css.checkRow, children: [
      /* @__PURE__ */ jsx(
        "input",
        {
          type: "checkbox",
          checked: modelEnabled(filter, entry.provider, entry.model),
          onChange: () => {
            onChange(toggleModel(filter, entry.provider, entry.model));
          }
        }
      ),
      /* @__PURE__ */ jsx("span", { className: css.name, title: entry.model, children: entry.name }),
      /* @__PURE__ */ jsx("span", { className: css.modelId, title: entry.model, children: entry.model })
    ] }) }, `${entry.provider}/${entry.model}`)) })
  ] }, group.provider)) });
}
function groupByProviderList(catalog) {
  const groups = [];
  let current;
  for (const entry of catalog) {
    if (current?.provider !== entry.provider) {
      current = { provider: entry.provider, entries: [] };
      groups.push(current);
    }
    current.entries.push(entry);
  }
  return groups;
}
function TrendRow({ item, t }) {
  const [expanded, setExpanded] = useState(false);
  const allPoints = item.points;
  const recent = allPoints.slice(-TREND_DOT_CAP);
  const canExpand = allPoints.length > TREND_DOT_CAP;
  const expandedPoints = expanded ? [...allPoints].reverse() : [];
  return /* @__PURE__ */ jsxs("li", { className: expanded ? `${css.trendRow} ${css.trendRowExpanded}` : css.trendRow, children: [
    /* @__PURE__ */ jsxs("div", { className: css.trendRowMain, children: [
      /* @__PURE__ */ jsx("span", { className: css.trendName, title: item.key, children: item.name }),
      /* @__PURE__ */ jsx("span", { className: css.dotStrip, children: recent.map((point, index) => {
        const label = pointTitle(point, t, formatTimestamp(point.checkedAt));
        return /* @__PURE__ */ jsx(
          "span",
          {
            className: point.ok ? css.pointOk : point.code === PROBE_TIMEOUT_CODE ? css.pointWarn : css.pointErr,
            title: label,
            role: "img",
            "aria-label": label
          },
          index
        );
      }) }),
      /* @__PURE__ */ jsxs("span", { className: css.trendMeta, children: [
        t("trend.okRate", { percent: item.okRate }),
        " \xB7 ",
        formatLatency(item.avgTotalMs)
      ] }),
      canExpand ? /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: css.trendToggle,
          "aria-expanded": expanded,
          "aria-label": expanded ? t("trend.collapse") : t("trend.expand"),
          onClick: () => {
            setExpanded((current) => !current);
          },
          children: expanded ? t("trend.collapse") : t("trend.more")
        }
      ) : null
    ] }),
    expanded ? /* @__PURE__ */ jsxs("div", { className: css.trendDetail, children: [
      /* @__PURE__ */ jsx("div", { className: css.trendSummary, children: t("trend.summary", {
        count: allPoints.length,
        avg: formatLatency(item.avgTotalMs),
        percent: item.okRate
      }) }),
      /* @__PURE__ */ jsx("ul", { className: css.trendDetailList, children: expandedPoints.map((point, index) => /* @__PURE__ */ jsxs("li", { className: css.trendDetailRow, children: [
        /* @__PURE__ */ jsx("span", { className: css.trendDetailTime, children: formatTimestamp(point.checkedAt) }),
        /* @__PURE__ */ jsx(
          StateDot,
          {
            state: point.ok ? "done" : point.code === PROBE_TIMEOUT_CODE ? "warning" : "error",
            className: css.rowDot
          }
        ),
        /* @__PURE__ */ jsx("span", { className: point.ok ? css.trendDetailOk : css.trendDetailFail, children: point.ok ? `${t("history.ok")} ${formatLatency(point.totalMs)}` : point.code === PROBE_TIMEOUT_CODE ? t("history.timeout") : t("history.failed", { code: point.code }) }),
        point.ok && point.tps !== void 0 ? /* @__PURE__ */ jsx("span", { className: css.trendDetailTps, children: t("trend.throughput", { value: point.tps }) }) : null
      ] }, index)) })
    ] }) : null
  ] });
}
function TrendBoard({ series, t }) {
  if (series.length === 0) {
    return /* @__PURE__ */ jsx("p", { className: css.emptyNote, children: t("trend.empty") });
  }
  const pointCount = Math.min(TREND_DOT_CAP, Math.max(...series.map((item) => item.points.length)));
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("p", { className: css.trendLegend, children: t("trend.legend", { count: pointCount }) }),
    /* @__PURE__ */ jsx("ul", { className: css.trendList, children: series.map((item) => /* @__PURE__ */ jsx(TrendRow, { item, t }, item.key)) })
  ] });
}
function CustomRefreshInput({
  refreshSeconds,
  setRefreshSeconds,
  t
}) {
  const isCustom = refreshSeconds > 0 && !REFRESH_CHOICES.includes(refreshSeconds);
  const [draft, setDraft] = useState(isCustom ? String(refreshSeconds) : "");
  useEffect(() => {
    setDraft(isCustom ? String(refreshSeconds) : "");
  }, [refreshSeconds, isCustom]);
  const commit = () => {
    const parsed = Number(draft.trim());
    if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_REFRESH_SECONDS) {
      setRefreshSeconds(parsed);
    } else {
      setDraft(isCustom ? String(refreshSeconds) : "");
    }
  };
  return /* @__PURE__ */ jsxs("label", { className: css.customRefresh, children: [
    /* @__PURE__ */ jsx("span", { className: css.customRefreshLabel, children: t("settings.refresh.custom") }),
    /* @__PURE__ */ jsx(
      "input",
      {
        type: "number",
        className: css.customRefreshInput,
        value: draft,
        min: 1,
        max: MAX_REFRESH_SECONDS,
        step: 1,
        placeholder: t("settings.refresh.custom"),
        "aria-label": t("settings.refresh.custom"),
        onChange: (event) => {
          setDraft(event.target.value);
        },
        onBlur: commit,
        onKeyDown: (event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }
      }
    ),
    /* @__PURE__ */ jsx("span", { className: css.customRefreshUnit, children: t("settings.refresh.customUnit") })
  ] });
}
function SettingsBoard({
  settings,
  setPosition,
  setRefreshSeconds,
  t
}) {
  return /* @__PURE__ */ jsxs("div", { className: css.settings, children: [
    /* @__PURE__ */ jsxs("div", { className: css.settingRow, children: [
      /* @__PURE__ */ jsx("span", { className: css.settingLabel, children: t("settings.position.label") }),
      /* @__PURE__ */ jsx("div", { className: css.pills, children: ["sidebar", "header"].map((option) => /* @__PURE__ */ jsx(
        "button",
        {
          type: "button",
          className: settings.position === option ? `${css.pill} ${css.pillActive}` : css.pill,
          "aria-pressed": settings.position === option,
          onClick: () => {
            setPosition(option);
          },
          children: t(option === "sidebar" ? "settings.position.sidebar" : "settings.position.header")
        },
        option
      )) })
    ] }),
    /* @__PURE__ */ jsxs("div", { className: css.settingRow, children: [
      /* @__PURE__ */ jsx("span", { className: css.settingLabel, children: t("settings.refresh.label") }),
      /* @__PURE__ */ jsxs("div", { className: css.pills, children: [
        REFRESH_CHOICES.map((seconds) => /* @__PURE__ */ jsx(
          "button",
          {
            type: "button",
            className: settings.refreshSeconds === seconds ? `${css.pill} ${css.pillActive}` : css.pill,
            "aria-pressed": settings.refreshSeconds === seconds,
            onClick: () => {
              setRefreshSeconds(seconds);
            },
            children: seconds === 0 ? t("settings.refresh.off") : t("settings.refresh.seconds", { seconds })
          },
          seconds
        )),
        /* @__PURE__ */ jsx(CustomRefreshInput, { refreshSeconds: settings.refreshSeconds, setRefreshSeconds, t })
      ] })
    ] })
  ] });
}
function AggregateChips({ aggregate, t }) {
  if (aggregate === null || aggregate.total === 0) return null;
  return /* @__PURE__ */ jsxs(Fragment, { children: [
    /* @__PURE__ */ jsx("span", { className: css.summaryChip, children: t("summary.online", { count: aggregate.ok }) }),
    aggregate.failing > 0 ? /* @__PURE__ */ jsx("span", { className: `${css.summaryChip} ${css.summaryChipFailing}`, children: t("summary.failing", { count: aggregate.failing }) }) : null,
    aggregate.avgTotalMs !== null ? /* @__PURE__ */ jsx("span", { className: css.summaryChip, children: t("summary.avgLatency", { value: formatLatency(aggregate.avgTotalMs) }) }) : null
  ] });
}
function ChartsRow({ rounds, t }) {
  const [hover, setHover] = useState(null);
  if (rounds.length === 0) {
    return /* @__PURE__ */ jsx("p", { className: css.emptyNote, children: t("summary.none") });
  }
  const clear = () => {
    setHover(null);
  };
  const hoverIndex = hover?.index ?? null;
  const tooltipLeft = hoverIndex === null ? 0 : Math.max(8, Math.min(92, (hoverIndex + 0.5) / rounds.length * 100));
  const hovered = hoverIndex === null ? null : rounds[hoverIndex] ?? null;
  return /* @__PURE__ */ jsxs("div", { className: css.charts, children: [
    /* @__PURE__ */ jsxs("div", { className: css.chartCard, onMouseLeave: clear, children: [
      /* @__PURE__ */ jsx("span", { className: css.chartTitle, children: t("chart.status") }),
      /* @__PURE__ */ jsx(
        StatusSparkline,
        {
          rounds,
          hover: hoverIndex,
          onHover: (index) => {
            setHover({ index, source: "status" });
          }
        }
      ),
      hover !== null && hover.source === "status" && hovered !== null ? /* @__PURE__ */ jsx(
        ChartTooltip,
        {
          leftPct: tooltipLeft,
          text: `${t("summary.online", { count: hovered.ok })} \xB7 ${t("summary.failing", { count: hovered.failing })} \xB7 ${formatTimestamp(hovered.checkedAt)}`
        }
      ) : null
    ] }),
    /* @__PURE__ */ jsxs("div", { className: css.chartCard, onMouseLeave: clear, children: [
      /* @__PURE__ */ jsx("span", { className: css.chartTitle, children: t("chart.latency") }),
      /* @__PURE__ */ jsx(
        LatencySparkline,
        {
          rounds,
          hover: hoverIndex,
          onHover: (index) => {
            setHover({ index, source: "latency" });
          }
        }
      ),
      hover !== null && hover.source === "latency" && hovered !== null ? /* @__PURE__ */ jsx(
        ChartTooltip,
        {
          leftPct: tooltipLeft,
          text: `${t("summary.avgLatency", { value: formatLatency(hovered.avgLatency) })} \xB7 ${formatTimestamp(hovered.checkedAt)}`
        }
      ) : null
    ] })
  ] });
}
function ChartTooltip({ leftPct, text }) {
  return /* @__PURE__ */ jsx("div", { className: css.chartTooltip, style: { left: `${leftPct}%` }, children: text });
}
function StatusSparkline({ rounds, hover, onHover }) {
  const max = Math.max(1, ...rounds.map((round) => round.ok + round.failing));
  const slot = 4;
  const height = 40;
  return /* @__PURE__ */ jsx(
    "svg",
    {
      className: css.chartSvg,
      viewBox: `0 0 ${Math.max(rounds.length * slot, 1)} ${height}`,
      preserveAspectRatio: "none",
      role: "img",
      children: rounds.map((round, index) => {
        const x = index * slot;
        const okHeight = Math.round(round.ok / max * (height - 2));
        const failHeight = Math.round(round.failing / max * (height - 2));
        return /* @__PURE__ */ jsxs("g", { children: [
          hover === index ? /* @__PURE__ */ jsx("rect", { x, y: 0, width: slot - 1, height, fill: "var(--dsw-alias-interactive-bg-hover)" }) : null,
          failHeight > 0 ? /* @__PURE__ */ jsx(
            "rect",
            {
              x,
              y: height - 1 - failHeight,
              width: slot - 1,
              height: failHeight,
              fill: "var(--dsw-alias-state-error-primary)"
            }
          ) : null,
          okHeight > 0 ? /* @__PURE__ */ jsx(
            "rect",
            {
              x,
              y: height - 1 - okHeight - failHeight,
              width: slot - 1,
              height: okHeight,
              fill: "var(--dsw-alias-state-success-primary)"
            }
          ) : null,
          /* @__PURE__ */ jsx(
            "rect",
            {
              x,
              y: 0,
              width: slot,
              height,
              fill: "transparent",
              onMouseEnter: () => {
                onHover(index);
              },
              onClick: () => {
                onHover(index);
              }
            }
          )
        ] }, round.checkedAt);
      })
    }
  );
}
function LatencySparkline({ rounds, hover, onHover }) {
  const height = 40;
  const points = rounds.flatMap((round, index) => round.avgLatency === null ? [] : [{ index, value: round.avgLatency }]);
  const min = points.length > 0 ? Math.min(...points.map((point) => point.value)) : 0;
  const max = points.length > 0 ? Math.max(...points.map((point) => point.value)) : 1;
  const span = Math.max(1, max - min);
  const xOf = (index) => rounds.length <= 1 ? 50 : index / (rounds.length - 1) * 100;
  const yOf = (value) => height - 4 - (value - min) / span * (height - 8);
  let path = "";
  let previousIndex = -1;
  for (const point of points) {
    const gap = previousIndex >= 0 && point.index !== previousIndex + 1;
    path += `${path === "" || gap ? "M" : "L"}${xOf(point.index).toFixed(1)},${yOf(point.value).toFixed(1)}`;
    previousIndex = point.index;
  }
  const hoverPoint = hover === null ? void 0 : points.find((point) => point.index === hover);
  const columnWidth = 100 / rounds.length;
  return /* @__PURE__ */ jsx(Fragment, { children: /* @__PURE__ */ jsxs("div", { className: css.chartPlot, children: [
    /* @__PURE__ */ jsxs(
      "svg",
      {
        className: css.chartSvg,
        viewBox: `0 0 100 ${height}`,
        preserveAspectRatio: "none",
        role: "img",
        children: [
          points.length >= 2 ? /* @__PURE__ */ jsx(
            "path",
            {
              d: path,
              fill: "none",
              stroke: "var(--dsw-alias-state-warn-primary)",
              strokeWidth: 1.5,
              vectorEffect: "non-scaling-stroke",
              strokeLinejoin: "round",
              strokeLinecap: "round"
            }
          ) : null,
          rounds.map((round, index) => /* @__PURE__ */ jsx(
            "rect",
            {
              x: index / rounds.length * 100,
              y: 0,
              width: columnWidth,
              height,
              fill: "transparent",
              onMouseEnter: () => {
                onHover(index);
              },
              onClick: () => {
                onHover(index);
              }
            },
            round.checkedAt
          ))
        ]
      }
    ),
    hoverPoint !== void 0 ? /* @__PURE__ */ jsx(
      "span",
      {
        className: css.chartHoverDot,
        style: {
          left: `${xOf(hoverPoint.index).toFixed(2)}%`,
          top: `${(yOf(hoverPoint.value) / height * 100).toFixed(2)}%`
        }
      }
    ) : null
  ] }) });
}
function HealthView({
  useHealth,
  useHealthSettings,
  refresh,
  setPosition,
  setRefreshSeconds,
  syncFilter,
  narrowLabel = false,
  fullWidth = false,
  t
}) {
  const data = useHealth((value) => value);
  const settings = useHealthSettings((value) => value);
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState("status");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [filterDraft, setFilterDraft] = useState({});
  const rootRef = useRef(null);
  const triggerRef = useRef(null);
  const panelRef = useRef(null);
  const [fixedPos, setFixedPos] = useState(null);
  const tabsBaseId = useId();
  useEffect(() => {
    if (!open) return;
    const checkedAt = data.view?.snapshot.checkedAt;
    if (checkedAt === void 0 || Date.now() - Date.parse(checkedAt) > 9e4) {
      refresh();
    }
  }, [open]);
  useEffect(() => {
    if (settingsOpen) setFilterDraft(data.view?.filter ?? {});
  }, [settingsOpen]);
  useLayoutEffect(() => {
    if (!open) {
      setFixedPos(null);
      return;
    }
    const place = () => {
      const trigger2 = triggerRef.current;
      const panel2 = panelRef.current;
      if (trigger2 === null || panel2 === null) return;
      const r = trigger2.getBoundingClientRect();
      const MARGIN = 12;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const lw = panel2.offsetWidth;
      const lh = panel2.offsetHeight;
      const popUpward = settings.position === "sidebar";
      let x = r.left;
      let y = popUpward ? r.top - lh - 6 : r.bottom + 6;
      if (lw > 0) x = Math.min(Math.max(x, MARGIN), vw - lw - MARGIN);
      if (lh > 0) y = Math.min(Math.max(y, MARGIN), vh - lh - MARGIN);
      setFixedPos({ left: x, top: y });
    };
    place();
    const panel = panelRef.current;
    const observer = panel !== null && typeof ResizeObserver === "function" ? new ResizeObserver(place) : void 0;
    observer?.observe(panel);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      observer?.disconnect();
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open, settings.position]);
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event) => {
      if (!(event.target instanceof Node)) return;
      if (rootRef.current?.contains(event.target) === true) return;
      if (panelRef.current?.contains(event.target) === true) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, setOpen]);
  const aggregate = useMemo(
    () => data.view === null ? null : summarize(data.view.snapshot.models),
    [data.view]
  );
  const chartRounds = useMemo(
    () => data.view === null ? [] : buildRoundSeries(data.view.history),
    [data.view]
  );
  const trend = useMemo(
    () => data.view === null ? [] : filterTrendSeries(buildTrendSeries(data.view.history), data.view.filter),
    [data.view]
  );
  const tone = aggregateTone(aggregate, data.loadState === "error");
  const checkedLabel = t("panel.aria");
  const pillsVisible = !narrowLabel && aggregate !== null && aggregate.total > 0;
  const showDot = narrowLabel || !pillsVisible || data.loadState === "error";
  const trigger = /* @__PURE__ */ jsxs(
    "button",
    {
      ref: triggerRef,
      type: "button",
      className: fullWidth ? `${css.trigger} ${css.triggerWide}` : css.trigger,
      "aria-expanded": open,
      "aria-label": t("chip.label"),
      title: t("panel.title"),
      onClick: () => {
        setOpen((current) => !current);
      },
      children: [
        showDot ? /* @__PURE__ */ jsx(StateDot, { state: tone, className: css.triggerDot }) : null,
        pillsVisible ? /* @__PURE__ */ jsx(AggregateChips, { aggregate, t }) : null,
        !pillsVisible && !narrowLabel ? /* @__PURE__ */ jsx("span", { className: css.triggerLabel, children: t("chip.label") }) : null,
        /* @__PURE__ */ jsx(IconChevronDownOutline14, { className: open ? css.triggerOpen : void 0 })
      ]
    }
  );
  const onTablistKeyDown = (event) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab === "status" ? "trend" : "status";
    setTab(next);
    panelRef.current?.querySelector(`[data-tab-id="${tabsBaseId}-${next}"]`)?.focus();
  };
  return /* @__PURE__ */ jsxs("div", { ref: rootRef, className: fullWidth ? `${css.root} ${css.rootFull}` : css.root, children: [
    trigger,
    open ? createPortal(
      /* @__PURE__ */ jsxs(
        "div",
        {
          ref: panelRef,
          className: css.panel,
          style: fixedPos ?? { visibility: "hidden", left: 0, top: 0 },
          role: "dialog",
          "aria-label": checkedLabel,
          children: [
            /* @__PURE__ */ jsxs("header", { className: css.panelHead, children: [
              /* @__PURE__ */ jsx("span", { className: css.panelTitle, children: t("panel.title") }),
              /* @__PURE__ */ jsx(
                "span",
                {
                  className: css.recency,
                  title: data.view?.snapshot.checkedAt === void 0 ? void 0 : formatTimestamp(data.view.snapshot.checkedAt),
                  children: recencyLabel(recency(data.view?.snapshot.checkedAt, Date.now()), t)
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  className: css.iconButton,
                  "aria-label": data.refreshing ? t("action.refreshing") : t("action.refresh"),
                  title: data.refreshing ? t("action.refreshing") : t("action.refresh"),
                  disabled: data.refreshing,
                  onClick: refresh,
                  children: /* @__PURE__ */ jsx(IconRefreshOutline14, { className: data.refreshing ? css.spin : void 0 })
                }
              ),
              settingsOpen ? /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  className: `${css.iconButton} ${css.iconButtonActive}`,
                  "aria-label": t("edit.done"),
                  "aria-pressed": true,
                  title: t("edit.done"),
                  onClick: () => {
                    syncFilter(filterDraft);
                    setSettingsOpen(false);
                  },
                  children: /* @__PURE__ */ jsx("svg", { viewBox: "0 0 14 14", width: 14, height: 14, "aria-hidden": "true", children: /* @__PURE__ */ jsx(
                    "path",
                    {
                      d: "M2.5 7.5 5.5 10.5 11.5 3.5",
                      fill: "none",
                      stroke: "currentColor",
                      strokeWidth: "1.6",
                      strokeLinecap: "round",
                      strokeLinejoin: "round"
                    }
                  ) })
                }
              ) : /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  className: css.iconButton,
                  "aria-label": t("action.settings.show"),
                  "aria-pressed": false,
                  title: t("action.settings.show"),
                  onClick: () => {
                    setSettingsOpen((current) => !current);
                  },
                  children: /* @__PURE__ */ jsx(IconSettingsOutline14, {})
                }
              ),
              /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  className: css.iconButton,
                  "aria-label": t("action.close"),
                  title: t("action.close"),
                  onClick: () => {
                    setOpen(false);
                  },
                  children: /* @__PURE__ */ jsx(IconCloseOutline16, { size: 14 })
                }
              )
            ] }),
            settingsOpen ? /* @__PURE__ */ jsx(
              SettingsBoard,
              {
                settings,
                setPosition,
                setRefreshSeconds,
                t
              }
            ) : null,
            data.view === null && data.loadState === "booting" ? /* @__PURE__ */ jsx("p", { className: css.emptyNote, children: t("empty.loading") }) : null,
            data.view === null && data.loadState === "error" ? /* @__PURE__ */ jsxs("div", { className: css.emptyNote, children: [
              /* @__PURE__ */ jsx("span", { children: t("empty.error", { message: data.errorMessage ?? "" }) }),
              /* @__PURE__ */ jsx("button", { type: "button", className: css.retry, onClick: refresh, children: t("action.retry") })
            ] }) : null,
            data.view !== null ? /* @__PURE__ */ jsxs(Fragment, { children: [
              data.loadState === "error" && data.errorMessage !== null ? /* @__PURE__ */ jsx("p", { className: css.staleNote, children: t("empty.error", { message: data.errorMessage }) }) : null,
              /* @__PURE__ */ jsx(ChartsRow, { rounds: chartRounds, t }),
              /* @__PURE__ */ jsx("div", { className: css.tabs, role: "tablist", onKeyDown: onTablistKeyDown, children: ["status", "trend"].map((option) => /* @__PURE__ */ jsx(
                "button",
                {
                  type: "button",
                  role: "tab",
                  id: `${tabsBaseId}-${option}-tab`,
                  "aria-selected": tab === option,
                  "aria-controls": `${tabsBaseId}-panel`,
                  "data-tab-id": `${tabsBaseId}-${option}`,
                  tabIndex: tab === option ? 0 : -1,
                  className: tab === option ? `${css.tab} ${css.tabActive}` : css.tab,
                  onClick: () => {
                    setTab(option);
                  },
                  children: t(option === "status" ? "tab.status" : "tab.trend")
                },
                option
              )) }),
              /* @__PURE__ */ jsx(
                "div",
                {
                  className: css.board,
                  role: "tabpanel",
                  id: `${tabsBaseId}-panel`,
                  "aria-labelledby": `${tabsBaseId}-${tab}-tab`,
                  children: tab === "status" ? settingsOpen ? /* @__PURE__ */ jsx(
                    EditableStatusBoard,
                    {
                      catalog: data.view.catalog ?? [],
                      filter: filterDraft,
                      onChange: setFilterDraft,
                      t
                    }
                  ) : /* @__PURE__ */ jsx(StatusBoard, { models: data.view.snapshot.models, t }) : /* @__PURE__ */ jsx(TrendBoard, { series: trend, t })
                }
              ),
              settingsOpen && tab === "status" ? /* @__PURE__ */ jsxs("div", { className: css.editFooter, children: [
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    className: css.retry,
                    onClick: () => {
                      setSettingsOpen(false);
                    },
                    children: t("edit.cancel")
                  }
                ),
                /* @__PURE__ */ jsx(
                  "button",
                  {
                    type: "button",
                    className: `${css.retry} ${css.editDone}`,
                    onClick: () => {
                      syncFilter(filterDraft);
                      setSettingsOpen(false);
                    },
                    children: t("edit.done")
                  }
                )
              ] }) : null
            ] }) : null
          ]
        }
      ),
      document.body
    ) : null
  ] });
}
function ModelHealthFooterAction({
  wide,
  useHealth,
  useHealthSettings,
  refresh,
  setPosition,
  setRefreshSeconds,
  syncFilter,
  t
}) {
  const rowRef = useRef(null);
  useEffect(() => {
    if (!wide) return;
    const container = flexRowOf(rowRef.current);
    if (container === null) return;
    const previous = container.style.flexWrap;
    container.style.flexWrap = "wrap";
    return () => {
      container.style.flexWrap = previous;
    };
  }, [wide]);
  return /* @__PURE__ */ jsx("div", { ref: rowRef, className: wide ? `${css.footerRow} ${css.footerRowWide}` : css.footerRow, children: /* @__PURE__ */ jsx(
    HealthView,
    {
      narrowLabel: !wide,
      fullWidth: wide,
      showStrip: wide,
      useHealth,
      useHealthSettings,
      refresh,
      setPosition,
      setRefreshSeconds,
      syncFilter,
      t
    }
  ) });
}
function flexRowOf(root) {
  let node = root?.parentElement ?? null;
  while (node !== null && getComputedStyle(node).display === "contents") {
    node = node.parentElement;
  }
  return node;
}
function ModelHealthHeaderAction(props) {
  return /* @__PURE__ */ jsx(HealthView, { ...props });
}
export {
  ModelHealthFooterAction,
  ModelHealthHeaderAction
};
