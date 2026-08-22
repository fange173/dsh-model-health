import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Status-entry component: a compact chip (state dot + label + healthy/total
 * count) whose popover presents the live per-model status list, retained-round
 * trend strips, and a small display-settings section. All data arrives through
 * inject-bound selector hooks and plain callbacks; derivation lives in
 * `view.ts`.
 */
import { useEffect, useId, useLayoutEffect, useMemo, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { IconChevronDownOutline14, IconCloseOutline16, IconRefreshOutline14, IconSettingsOutline14, StateDot, } from '@deepseek-ai/dsh-client-ui-primitives';
import { aggregateTone, buildRoundSeries, buildTrendSeries, filterTrendSeries, formatLatency, formatTimestamp, groupByProvider, modelEnabled, providerEnabled, PROBE_TIMEOUT_CODE, recency, resultTone, summarize, toggleModel, toggleProvider, TREND_DOT_CAP, } from "./view.js";
import { MAX_REFRESH_SECONDS } from "./controller.js";
import css from './ModelHealthAction.module.css';
const REFRESH_CHOICES = [0, 30, 60, 120, 300];
function recencyLabel(health, t) {
    switch (health.kind) {
        case 'none': return t('recency.none');
        case 'justNow': return t('recency.justNow');
        case 'minutes': return t('recency.minutes', { minutes: health.minutes });
        /* v8 ignore next -- hours-only branch reached by long-idle views */
        case 'hours': return t('recency.hours', { hours: health.hours });
    }
}
function pointTitle(point, t, checkedLabel) {
    const status = point.ok
        ? `${t('history.ok')} ${formatLatency(point.totalMs)}`
        : point.code === PROBE_TIMEOUT_CODE ? t('history.timeout') : t('history.failed', { code: point.code });
    return t('history.title', { checkedAt: checkedLabel, status });
}
function ModelRow({ model, t }) {
    const latency = formatLatency(model.ok ? model.totalMs : null);
    const detail = model.ok
        ? t('latency.title', { ttft: formatLatency(model.ttftMs), total: formatLatency(model.totalMs) })
        : `${model.error?.code ?? 'unknown'}${model.error?.status !== undefined ? ` (${model.error.status})` : ''}`;
    return (_jsxs("li", { className: model.ok ? css.row : `${css.row} ${css.rowFailing}`, children: [_jsx(StateDot, { state: resultTone(model), className: css.rowDot }), _jsx("span", { className: css.name, title: model.model, children: model.name }), _jsx("span", { className: css.modelId, title: model.model, children: model.model }), _jsx("span", { className: model.ok ? css.latency : css.errorText, title: model.ok ? detail : (model.error?.message ?? detail), children: model.ok ? latency : (model.error?.code ?? 'unknown') })] }));
}
function StatusBoard({ models, t }) {
    const groups = useMemo(() => groupByProvider(models), [models]);
    return (_jsx("div", { className: css.list, children: groups.map(group => (_jsxs("section", { className: css.providerGroup, children: [_jsxs("header", { className: css.providerHead, children: [_jsx("span", { className: css.providerName, children: group.provider }), _jsx("span", { className: css.providerCount, children: t('provider.count', { count: group.models.length }) })] }), _jsx("ul", { className: css.providerRows, children: group.models.map(model => _jsx(ModelRow, { model: model, t: t }, `${model.provider}/${model.model}`)) })] }, group.provider))) }));
}
/**
 * The model checkbox list shown while the settings gear is on. Every registered
 * provider and model (from the host catalog) renders a checkbox reflecting the
 * draft selection; unchecking hides the model and stops probing it after "done".
 */
function EditableStatusBoard({ catalog, filter, onChange, t, }) {
    const groups = useMemo(() => groupByProviderList(catalog), [catalog]);
    if (catalog.length === 0) {
        return _jsx("p", { className: css.emptyNote, children: t('summary.none') });
    }
    return (_jsx("div", { className: css.list, children: groups.map(group => (_jsxs("section", { className: css.providerGroup, children: [_jsxs("header", { className: css.providerHead, children: [_jsxs("label", { className: css.checkRow, children: [_jsx("input", { type: "checkbox", checked: providerEnabled(filter, group.provider), onChange: () => { onChange(toggleProvider(filter, group.provider)); } }), _jsx("span", { className: css.providerName, children: group.provider })] }), _jsx("span", { className: css.providerCount, children: t('provider.count', { count: group.entries.length }) })] }), _jsx("ul", { className: css.providerRows, children: group.entries.map(entry => (_jsx("li", { className: css.catalogRow, children: _jsxs("label", { className: css.checkRow, children: [_jsx("input", { type: "checkbox", checked: modelEnabled(filter, entry.provider, entry.model), onChange: () => { onChange(toggleModel(filter, entry.provider, entry.model)); } }), _jsx("span", { className: css.name, title: entry.model, children: entry.name }), _jsx("span", { className: css.modelId, title: entry.model, children: entry.model })] }) }, `${entry.provider}/${entry.model}`))) })] }, group.provider))) }));
}
/** Group the catalog entries under their providers, preserving order. */
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
    return (_jsxs("li", { className: expanded ? `${css.trendRow} ${css.trendRowExpanded}` : css.trendRow, children: [_jsxs("div", { className: css.trendRowMain, children: [_jsx("span", { className: css.trendName, title: item.key, children: item.name }), _jsx("span", { className: css.dotStrip, children: recent.map((point, index) => {
                            const label = pointTitle(point, t, formatTimestamp(point.checkedAt));
                            return (_jsx("span", { className: point.ok ? css.pointOk
                                    : point.code === PROBE_TIMEOUT_CODE ? css.pointWarn
                                        : css.pointErr, title: label, role: "img", "aria-label": label }, index));
                        }) }), _jsxs("span", { className: css.trendMeta, children: [t('trend.okRate', { percent: item.okRate }), ' · ', formatLatency(item.avgTotalMs)] }), canExpand
                        ? (_jsx("button", { type: "button", className: css.trendToggle, "aria-expanded": expanded, "aria-label": expanded ? t('trend.collapse') : t('trend.expand'), onClick: () => { setExpanded(current => !current); }, children: expanded
                                ? t('trend.collapse')
                                : t('trend.more') }))
                        : null] }), expanded
                ? (_jsxs("div", { className: css.trendDetail, children: [_jsx("div", { className: css.trendSummary, children: t('trend.summary', {
                                count: allPoints.length,
                                avg: formatLatency(item.avgTotalMs),
                                percent: item.okRate,
                            }) }), _jsx("ul", { className: css.trendDetailList, children: expandedPoints.map((point, index) => (_jsxs("li", { className: css.trendDetailRow, children: [_jsx("span", { className: css.trendDetailTime, children: formatTimestamp(point.checkedAt) }), _jsx(StateDot, { state: point.ok ? 'done' : point.code === PROBE_TIMEOUT_CODE ? 'warning' : 'error', className: css.rowDot }), _jsx("span", { className: point.ok ? css.trendDetailOk : css.trendDetailFail, children: point.ok
                                            ? `${t('history.ok')} ${formatLatency(point.totalMs)}`
                                            : point.code === PROBE_TIMEOUT_CODE ? t('history.timeout') : t('history.failed', { code: point.code }) }), point.ok && point.tps !== undefined
                                        ? _jsx("span", { className: css.trendDetailTps, children: t('trend.throughput', { value: point.tps }) })
                                        : null] }, index))) })] }))
                : null] }));
}
function TrendBoard({ series, t }) {
    if (series.length === 0) {
        return _jsx("p", { className: css.emptyNote, children: t('trend.empty') });
    }
    // The dot strip renders at most TREND_DOT_CAP points, so the legend must
    // describe that display window (the retained "all" count moves to the
    // expanded summary instead of implying every check is shown up front).
    const pointCount = Math.min(TREND_DOT_CAP, Math.max(...series.map(item => item.points.length)));
    return (_jsxs(_Fragment, { children: [_jsx("p", { className: css.trendLegend, children: t('trend.legend', { count: pointCount }) }), _jsx("ul", { className: css.trendList, children: series.map(item => _jsx(TrendRow, { item: item, t: t }, item.key)) })] }));
}
/** Hand-typed refresh cadence: commits a valid integer, otherwise reverts the draft. */
function CustomRefreshInput({ refreshSeconds, setRefreshSeconds, t, }) {
    const isCustom = refreshSeconds > 0 && !REFRESH_CHOICES.includes(refreshSeconds);
    const [draft, setDraft] = useState(isCustom ? String(refreshSeconds) : '');
    useEffect(() => {
        setDraft(isCustom ? String(refreshSeconds) : '');
    }, [refreshSeconds, isCustom]);
    const commit = () => {
        const parsed = Number(draft.trim());
        if (Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_REFRESH_SECONDS) {
            setRefreshSeconds(parsed);
        }
        else {
            setDraft(isCustom ? String(refreshSeconds) : '');
        }
    };
    return (_jsxs("label", { className: css.customRefresh, children: [_jsx("span", { className: css.customRefreshLabel, children: t('settings.refresh.custom') }), _jsx("input", { type: "number", className: css.customRefreshInput, value: draft, min: 1, max: MAX_REFRESH_SECONDS, step: 1, placeholder: t('settings.refresh.custom'), "aria-label": t('settings.refresh.custom'), onChange: (event) => { setDraft(event.target.value); }, onBlur: commit, onKeyDown: (event) => {
                    if (event.key === 'Enter') {
                        event.preventDefault();
                        commit();
                    }
                } }), _jsx("span", { className: css.customRefreshUnit, children: t('settings.refresh.customUnit') })] }));
}
function SettingsBoard({ settings, setPosition, setRefreshSeconds, t, }) {
    return (_jsxs("div", { className: css.settings, children: [_jsxs("div", { className: css.settingRow, children: [_jsx("span", { className: css.settingLabel, children: t('settings.position.label') }), _jsx("div", { className: css.pills, children: ['sidebar', 'header'].map(option => (_jsx("button", { type: "button", className: settings.position === option ? `${css.pill} ${css.pillActive}` : css.pill, "aria-pressed": settings.position === option, onClick: () => { setPosition(option); }, children: t(option === 'sidebar' ? 'settings.position.sidebar' : 'settings.position.header') }, option))) })] }), _jsxs("div", { className: css.settingRow, children: [_jsx("span", { className: css.settingLabel, children: t('settings.refresh.label') }), _jsxs("div", { className: css.pills, children: [REFRESH_CHOICES.map(seconds => (_jsx("button", { type: "button", className: settings.refreshSeconds === seconds ? `${css.pill} ${css.pillActive}` : css.pill, "aria-pressed": settings.refreshSeconds === seconds, onClick: () => { setRefreshSeconds(seconds); }, children: seconds === 0 ? t('settings.refresh.off') : t('settings.refresh.seconds', { seconds }) }, seconds))), _jsx(CustomRefreshInput, { refreshSeconds: settings.refreshSeconds, setRefreshSeconds: setRefreshSeconds, t: t })] })] })] }));
}
/**
 * The three aggregate pill chips (`N 正常 · M 异常 · 平均耗时 …`), shared by
 * the panel's first line and the wide sidebar footer row so both read the
 * same summary and stay in lockstep. Returns `null` while nothing has probed.
 */
function AggregateChips({ aggregate, t }) {
    if (aggregate === null || aggregate.total === 0)
        return null;
    return (_jsxs(_Fragment, { children: [_jsx("span", { className: css.summaryChip, children: t('summary.online', { count: aggregate.ok }) }), aggregate.failing > 0
                ? _jsx("span", { className: `${css.summaryChip} ${css.summaryChipFailing}`, children: t('summary.failing', { count: aggregate.failing }) })
                : null, aggregate.avgTotalMs !== null
                ? _jsx("span", { className: css.summaryChip, children: t('summary.avgLatency', { value: formatLatency(aggregate.avgTotalMs) }) })
                : null] }));
}
/**
 * Two side-by-side sparkline cards over retained rounds: per-round
 * ok/failing columns and the mean healthy latency line. Pure inline SVG — no
 * chart dependency, theme colors via CSS variables.
 */
function ChartsRow({ rounds, t }) {
    // One shared hover cursor, tagged with the card it came from so only the
    // hovered chart shows its tooltip (two side-by-side tooltips would overlap).
    const [hover, setHover] = useState(null);
    if (rounds.length === 0) {
        return _jsx("p", { className: css.emptyNote, children: t('summary.none') });
    }
    const clear = () => { setHover(null); };
    const hoverIndex = hover?.index ?? null;
    const tooltipLeft = hoverIndex === null ? 0 : Math.max(8, Math.min(92, ((hoverIndex + 0.5) / rounds.length) * 100));
    const hovered = hoverIndex === null ? null : rounds[hoverIndex] ?? null;
    return (_jsxs("div", { className: css.charts, children: [_jsxs("div", { className: css.chartCard, onMouseLeave: clear, children: [_jsx("span", { className: css.chartTitle, children: t('chart.status') }), _jsx(StatusSparkline, { rounds: rounds, hover: hoverIndex, onHover: (index) => { setHover({ index, source: 'status' }); } }), hover !== null && hover.source === 'status' && hovered !== null
                        ? (_jsx(ChartTooltip, { leftPct: tooltipLeft, text: `${t('summary.online', { count: hovered.ok })} · ${t('summary.failing', { count: hovered.failing })} · ${formatTimestamp(hovered.checkedAt)}` }))
                        : null] }), _jsxs("div", { className: css.chartCard, onMouseLeave: clear, children: [_jsx("span", { className: css.chartTitle, children: t('chart.latency') }), _jsx(LatencySparkline, { rounds: rounds, hover: hoverIndex, onHover: (index) => { setHover({ index, source: 'latency' }); } }), hover !== null && hover.source === 'latency' && hovered !== null
                        ? (_jsx(ChartTooltip, { leftPct: tooltipLeft, text: `${t('summary.avgLatency', { value: formatLatency(hovered.avgLatency) })} · ${formatTimestamp(hovered.checkedAt)}` }))
                        : null] })] }));
}
function ChartTooltip({ leftPct, text }) {
    return _jsx("div", { className: css.chartTooltip, style: { left: `${leftPct}%` }, children: text });
}
/** Per-round stacked columns: healthy (success) below failing (error). */
function StatusSparkline({ rounds, hover, onHover }) {
    const max = Math.max(1, ...rounds.map(round => round.ok + round.failing));
    const slot = 4;
    const height = 40;
    return (_jsx("svg", { className: css.chartSvg, viewBox: `0 0 ${Math.max(rounds.length * slot, 1)} ${height}`, preserveAspectRatio: "none", role: "img", children: rounds.map((round, index) => {
            const x = index * slot;
            const okHeight = Math.round((round.ok / max) * (height - 2));
            const failHeight = Math.round((round.failing / max) * (height - 2));
            return (_jsxs("g", { children: [hover === index
                        ? _jsx("rect", { x: x, y: 0, width: slot - 1, height: height, fill: "var(--dsw-alias-interactive-bg-hover)" })
                        : null, failHeight > 0
                        ? (_jsx("rect", { x: x, y: height - 1 - failHeight, width: slot - 1, height: failHeight, fill: "var(--dsw-alias-state-error-primary)" }))
                        : null, okHeight > 0
                        ? (_jsx("rect", { x: x, y: height - 1 - okHeight - failHeight, width: slot - 1, height: okHeight, fill: "var(--dsw-alias-state-success-primary)" }))
                        : null, _jsx("rect", { x: x, y: 0, width: slot, height: height, fill: "transparent", onMouseEnter: () => { onHover(index); }, onClick: () => { onHover(index); } })] }, round.checkedAt));
        }) }));
}
/** Mean healthy latency line across rounds; gaps where a round had none. */
function LatencySparkline({ rounds, hover, onHover }) {
    const height = 40;
    const points = rounds.flatMap((round, index) => round.avgLatency === null ? [] : [{ index, value: round.avgLatency }]);
    const min = points.length > 0 ? Math.min(...points.map(point => point.value)) : 0;
    const max = points.length > 0 ? Math.max(...points.map(point => point.value)) : 1;
    const span = Math.max(1, max - min);
    const xOf = (index) => rounds.length <= 1 ? 50 : (index / (rounds.length - 1)) * 100;
    const yOf = (value) => height - 4 - ((value - min) / span) * (height - 8);
    let path = '';
    let previousIndex = -1;
    for (const point of points) {
        const gap = previousIndex >= 0 && point.index !== previousIndex + 1;
        path += `${path === '' || gap ? 'M' : 'L'}${xOf(point.index).toFixed(1)},${yOf(point.value).toFixed(1)}`;
        previousIndex = point.index;
    }
    const hoverPoint = hover === null ? undefined : points.find(point => point.index === hover);
    const columnWidth = 100 / rounds.length;
    // The svg stretches non-uniformly (preserveAspectRatio none), so the hover
    // marker is an HTML dot in a matching overlay box — a circle inside the svg
    // would render as a flattened ellipse.
    return (_jsx(_Fragment, { children: _jsxs("div", { className: css.chartPlot, children: [_jsxs("svg", { className: css.chartSvg, viewBox: `0 0 100 ${height}`, preserveAspectRatio: "none", role: "img", children: [points.length >= 2
                            ? (_jsx("path", { d: path, fill: "none", stroke: "var(--dsw-alias-state-warn-primary)", strokeWidth: 1.5, vectorEffect: "non-scaling-stroke", strokeLinejoin: "round", strokeLinecap: "round" }))
                            : null, rounds.map((round, index) => (_jsx("rect", { x: (index / rounds.length) * 100, y: 0, width: columnWidth, height: height, fill: "transparent", onMouseEnter: () => { onHover(index); }, onClick: () => { onHover(index); } }, round.checkedAt)))] }), hoverPoint !== undefined
                    ? (_jsx("span", { className: css.chartHoverDot, style: {
                            left: `${xOf(hoverPoint.index).toFixed(2)}%`,
                            top: `${((yOf(hoverPoint.value) / height) * 100).toFixed(2)}%`,
                        } }))
                    : null] }) }));
}
/**
 * The chip and its popover panel. Renders the trigger even before data arrives
 * so the entry is stable; the panel body covers loading, empty, and error
 * containers.
 * @param props - inject-bound hooks, callbacks, the namespace translator, and
 * the narrow-rail form flag the seat supplies.
 */
function HealthView({ useHealth, useHealthSettings, refresh, setPosition, setRefreshSeconds, syncFilter, narrowLabel = false, fullWidth = false, t, }) {
    const data = useHealth(value => value);
    const settings = useHealthSettings(value => value);
    const [open, setOpen] = useState(false);
    const [tab, setTab] = useState('status');
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [editing, setEditing] = useState(false);
    const [filterDraft, setFilterDraft] = useState({});
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const panelRef = useRef(null);
    const [fixedPos, setFixedPos] = useState(null);
    const tabsBaseId = useId();
    // Opening the panel checks staleness every time — including the first open.
    // The host probes on a slow cadence (default 300s) and a newly added model
    // only becomes visible after a fresh round, so a view older than 90s (or
    // one that never probed) forces one immediately.
    useEffect(() => {
        if (!open)
            return;
        const checkedAt = data.view?.snapshot.checkedAt;
        if (checkedAt === undefined || Date.now() - Date.parse(checkedAt) > 90_000) {
            refresh();
        }
    }, [open]);
    // Enter editing: snapshot the host's current selection into the draft so the
    // checkboxes start from the truth, not a leftover.
    useEffect(() => {
        if (settingsOpen)
            setFilterDraft(data.view?.filter ?? {});
    }, [settingsOpen]);
    // Portal the panel into document.body so the sidebar's overflow:hidden never
    // crops it. Position from the trigger rect: pop upward from the sidebar seat,
    // downward from the header seat, clamped to the viewport with 12px margins.
    useLayoutEffect(() => {
        if (!open) {
            setFixedPos(null);
            return;
        }
        const place = () => {
            const trigger = triggerRef.current;
            const panel = panelRef.current;
            /* v8 ignore next -- refs are attached before the layout effect runs and the listeners die with it. */
            if (trigger === null || panel === null)
                return;
            const r = trigger.getBoundingClientRect();
            const MARGIN = 12;
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const lw = panel.offsetWidth;
            const lh = panel.offsetHeight;
            const popUpward = settings.position === 'sidebar';
            let x = r.left;
            let y = popUpward ? r.top - lh - 6 : r.bottom + 6;
            /* v8 ignore next -- jsdom reports offsetWidth as 0; the clamp fires in a real browser. */
            if (lw > 0)
                x = Math.min(Math.max(x, MARGIN), vw - lw - MARGIN);
            /* v8 ignore next -- jsdom reports offsetHeight as 0; the clamp fires in a real browser. */
            if (lh > 0)
                y = Math.min(Math.max(y, MARGIN), vh - lh - MARGIN);
            setFixedPos({ left: x, top: y });
        };
        place();
        // The panel height tracks its content, which changes on tab switch, a trend
        // expansion, a settings toggle, or a later data arrival. Each such resize
        // must re-clamp the fixed origin, or a taller tab overflows the bottom while
        // a shorter one leaves the panel floating above its anchor.
        const panel = panelRef.current;
        const observer = panel !== null && typeof ResizeObserver === 'function'
            ? new ResizeObserver(place)
            : undefined;
        /* v8 ignore next -- same null-panel case the guard above already covers. */
        observer?.observe(panel);
        window.addEventListener('scroll', place, true);
        window.addEventListener('resize', place);
        return () => {
            observer?.disconnect();
            window.removeEventListener('scroll', place, true);
            window.removeEventListener('resize', place);
        };
    }, [open, settings.position]);
    // Outside-pointer and Escape dismissal. The portaled panel lives outside the
    // trigger subtree in the DOM, so the check spans both refs.
    useEffect(() => {
        if (!open)
            return;
        const onPointerDown = (event) => {
            /* v8 ignore next -- pointerdown targets are always Nodes in practice. */
            if (!(event.target instanceof Node))
                return;
            if (rootRef.current?.contains(event.target) === true)
                return;
            if (panelRef.current?.contains(event.target) === true)
                return;
            setOpen(false);
        };
        const onKeyDown = (event) => {
            if (event.key !== 'Escape')
                return;
            setOpen(false);
            triggerRef.current?.focus();
        };
        document.addEventListener('pointerdown', onPointerDown);
        document.addEventListener('keydown', onKeyDown);
        return () => {
            document.removeEventListener('pointerdown', onPointerDown);
            document.removeEventListener('keydown', onKeyDown);
        };
    }, [open, setOpen]);
    const aggregate = useMemo(() => data.view === null ? null : summarize(data.view.snapshot.models), [data.view]);
    const chartRounds = useMemo(() => data.view === null ? [] : buildRoundSeries(data.view.history), [data.view]);
    const trend = useMemo(() => data.view === null ? [] : filterTrendSeries(buildTrendSeries(data.view.history), data.view.filter), [data.view]);
    const tone = aggregateTone(aggregate, data.loadState === 'error');
    const checkedLabel = t('panel.aria');
    const pillsVisible = !narrowLabel && aggregate !== null && aggregate.total > 0;
    // One trigger for every seat: the three summary pills once any model has
    // probed (`正常2 异常1 耗时910ms`). The status dot only leads when it has
    // something to say on its own — booting, fetch error, no models, or the
    // collapsed rail where there is no room for pills. The plain 模型健康 label
    // is the pre-data fallback and always stays the accessible name.
    const showDot = narrowLabel || !pillsVisible || data.loadState === 'error';
    const trigger = (_jsxs("button", { ref: triggerRef, type: "button", className: fullWidth ? `${css.trigger} ${css.triggerWide}` : css.trigger, "aria-expanded": open, "aria-label": t('chip.label'), title: t('panel.title'), onClick: () => { setOpen(current => !current); }, children: [showDot ? _jsx(StateDot, { state: tone, className: css.triggerDot }) : null, pillsVisible ? _jsx(AggregateChips, { aggregate: aggregate, t: t }) : null, !pillsVisible && !narrowLabel ? _jsx("span", { className: css.triggerLabel, children: t('chip.label') }) : null, _jsx(IconChevronDownOutline14, { className: open ? css.triggerOpen : undefined })] }));
    /** Arrow-key navigation between the two tabs, with automatic activation on move. */
    const onTablistKeyDown = (event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight')
            return;
        event.preventDefault();
        const next = tab === 'status' ? 'trend' : 'status';
        setTab(next);
        panelRef.current?.querySelector(`[data-tab-id="${tabsBaseId}-${next}"]`)?.focus();
    };
    return (_jsxs("div", { ref: rootRef, className: fullWidth ? `${css.root} ${css.rootFull}` : css.root, children: [trigger, open
                ? createPortal(_jsxs("div", { ref: panelRef, className: css.panel, style: fixedPos ?? { visibility: 'hidden', left: 0, top: 0 }, role: "dialog", "aria-label": checkedLabel, children: [_jsxs("header", { className: css.panelHead, children: [_jsx("span", { className: css.panelTitle, children: t('panel.title') }), _jsx("span", { className: css.recency, title: data.view?.snapshot.checkedAt === undefined
                                        ? undefined
                                        : formatTimestamp(data.view.snapshot.checkedAt), children: recencyLabel(recency(data.view?.snapshot.checkedAt, Date.now()), t) }), _jsx("button", { type: "button", className: css.iconButton, "aria-label": data.refreshing ? t('action.refreshing') : t('action.refresh'), title: data.refreshing ? t('action.refreshing') : t('action.refresh'), disabled: data.refreshing, onClick: refresh, children: _jsx(IconRefreshOutline14, { className: data.refreshing ? css.spin : undefined }) }), settingsOpen
                                    ? (_jsx("button", { type: "button", className: `${css.iconButton} ${css.iconButtonActive}`, "aria-label": t('edit.done'), "aria-pressed": true, title: t('edit.done'), onClick: () => {
                                            syncFilter(filterDraft);
                                            setSettingsOpen(false);
                                        }, children: _jsx("svg", { viewBox: "0 0 14 14", width: 14, height: 14, "aria-hidden": "true", children: _jsx("path", { d: "M2.5 7.5 5.5 10.5 11.5 3.5", fill: "none", stroke: "currentColor", strokeWidth: "1.6", strokeLinecap: "round", strokeLinejoin: "round" }) }) }))
                                    : (_jsx("button", { type: "button", className: css.iconButton, "aria-label": t('action.settings.show'), "aria-pressed": false, title: t('action.settings.show'), onClick: () => { setSettingsOpen(current => !current); }, children: _jsx(IconSettingsOutline14, {}) })), _jsx("button", { type: "button", className: css.iconButton, "aria-label": t('action.close'), title: t('action.close'), onClick: () => { setOpen(false); }, children: _jsx(IconCloseOutline16, { size: 14 }) })] }), settingsOpen
                            ? (_jsx(SettingsBoard, { settings: settings, setPosition: setPosition, setRefreshSeconds: setRefreshSeconds, t: t }))
                            : null, data.view === null && data.loadState === 'booting'
                            ? _jsx("p", { className: css.emptyNote, children: t('empty.loading') })
                            : null, data.view === null && data.loadState === 'error'
                            ? (_jsxs("div", { className: css.emptyNote, children: [_jsx("span", { children: t('empty.error', { message: data.errorMessage ?? '' }) }), _jsx("button", { type: "button", className: css.retry, onClick: refresh, children: t('action.retry') })] }))
                            : null, data.view !== null
                            ? (_jsxs(_Fragment, { children: [data.loadState === 'error' && data.errorMessage !== null
                                        ? _jsx("p", { className: css.staleNote, children: t('empty.error', { message: data.errorMessage }) })
                                        : null, _jsx(ChartsRow, { rounds: chartRounds, t: t }), _jsx("div", { className: css.tabs, role: "tablist", onKeyDown: onTablistKeyDown, children: ['status', 'trend'].map(option => (_jsx("button", { type: "button", role: "tab", id: `${tabsBaseId}-${option}-tab`, "aria-selected": tab === option, "aria-controls": `${tabsBaseId}-panel`, "data-tab-id": `${tabsBaseId}-${option}`, tabIndex: tab === option ? 0 : -1, className: tab === option ? `${css.tab} ${css.tabActive}` : css.tab, onClick: () => { setTab(option); }, children: t(option === 'status' ? 'tab.status' : 'tab.trend') }, option))) }), _jsx("div", { className: css.board, role: "tabpanel", id: `${tabsBaseId}-panel`, "aria-labelledby": `${tabsBaseId}-${tab}-tab`, children: tab === 'status'
                                            ? (settingsOpen
                                                ? (_jsx(EditableStatusBoard, { catalog: data.view.catalog ?? [], filter: filterDraft, onChange: setFilterDraft, t: t }))
                                                : _jsx(StatusBoard, { models: data.view.snapshot.models, t: t }))
                                            : _jsx(TrendBoard, { series: trend, t: t }) }), settingsOpen && tab === 'status'
                                        ? (_jsxs("div", { className: css.editFooter, children: [_jsx("button", { type: "button", className: css.retry, onClick: () => { setSettingsOpen(false); }, children: t('edit.cancel') }), _jsx("button", { type: "button", className: `${css.retry} ${css.editDone}`, onClick: () => {
                                                        syncFilter(filterDraft);
                                                        setSettingsOpen(false);
                                                    }, children: t('edit.done') })] }))
                                        : null] }))
                            : null] }), document.body)
                : null] }));
}
/**
 * Sidebar-footer registration seat: reads the column's `wide` flag and keeps
 * the rail form icon-only when it collapses.
 *
 * The host renders footer actions on one non-wrapping flex row, so a chip that
 * wants its own line cannot get one from CSS alone. Rather than patching the
 * host stylesheet, the seat asks its runtime flex container to wrap while
 * mounted — an inline style on the host's footer-actions row — and restores
 * whatever was there when it unmounts. The slot outlet wraps every occupant in
 * a `display: contents` anchor, so the seat's DOM parent is out of layout and
 * must be climbed past to reach the row that actually lays the occupants out.
 * @param props - sidebar seat props, injected face, and locale.
 */
export function ModelHealthFooterAction({ wide, useHealth, useHealthSettings, refresh, setPosition, setRefreshSeconds, syncFilter, t, }) {
    const rowRef = useRef(null);
    useEffect(() => {
        if (!wide)
            return;
        const container = flexRowOf(rowRef.current);
        /* v8 ignore next -- the slot container always exists around a mounted seat. */
        if (container === null)
            return;
        const previous = container.style.flexWrap;
        container.style.flexWrap = 'wrap';
        return () => {
            container.style.flexWrap = previous;
        };
    }, [wide]);
    return (_jsx("div", { ref: rowRef, className: wide ? `${css.footerRow} ${css.footerRowWide}` : css.footerRow, children: _jsx(HealthView, { narrowLabel: !wide, fullWidth: wide, showStrip: wide, useHealth: useHealth, useHealthSettings: useHealthSettings, refresh: refresh, setPosition: setPosition, setRefreshSeconds: setRefreshSeconds, syncFilter: syncFilter, t: t }) }));
}
/**
 * The nearest ancestor that generates the footer seat's flex context. The slot
 * outlet anchors every occupant in a `display: contents` element (so the host
 * flex row sees the occupants directly), which has no box of its own — setting
 * `flex-wrap` there would be a silent no-op. Climb past contents-only ancestors
 * to the host's footer-actions row that actually participates in layout.
 * @param root - the seat's root element.
 * @returns the flex row, or `null` before mount.
 */
function flexRowOf(root) {
    let node = root?.parentElement ?? null;
    while (node !== null && getComputedStyle(node).display === 'contents') {
        node = node.parentElement;
    }
    return node;
}
/**
 * Conversation-header registration seat: always roomy enough for the full
 * chip, so it renders the default form.
 * @param props - injected face and locale (the header's own props are unused).
 */
export function ModelHealthHeaderAction(props) {
    return _jsx(HealthView, { ...props });
}
//# sourceMappingURL=ModelHealthAction.js.map