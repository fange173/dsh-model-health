/** `modelHealth` namespace dictionaries. */
/** Dictionary namespace owned by this plugin. */
export declare const NS = "modelHealth";
/** Simplified Chinese dictionary (the key-set source of truth). */
export declare const zh: {
    readonly 'chip.label': "模型健康";
    readonly 'panel.title': "模型状态";
    readonly 'panel.aria': "模型状态";
    readonly 'recency.justNow': "刚刚更新";
    readonly 'recency.minutes': "{minutes} 分钟前更新";
    readonly 'recency.hours': "{hours} 小时前更新";
    readonly 'recency.none': "尚未检查";
    readonly 'action.refresh': "立即检查";
    readonly 'action.refreshing': "检查中…";
    readonly 'action.close': "关闭面板";
    readonly 'action.settings.show': "显示设置";
    readonly 'action.settings.hide': "收起设置";
    readonly 'summary.online': "正常{count}";
    readonly 'summary.failing': "异常{count}";
    readonly 'summary.none': "暂无已注册模型";
    readonly 'summary.avgLatency': "耗时{value}";
    readonly 'tab.status': "实时状态";
    readonly 'tab.trend': "历史趋势";
    readonly 'chart.status': "状态趋势";
    readonly 'chart.latency': "耗时趋势";
    readonly 'provider.count': "{count} 个模型";
    readonly 'trend.legend': "最近 {count} 次检查";
    readonly 'trend.okRate': "{percent}%";
    readonly 'trend.empty': "完成至少一轮检查后展示趋势";
    readonly 'empty.loading': "正在获取模型状态…";
    readonly 'empty.error': "获取失败：{message}";
    readonly 'action.retry': "重试";
    readonly 'settings.position.label': "显示位置";
    readonly 'settings.position.sidebar': "侧边栏";
    readonly 'settings.position.header': "会话顶栏";
    readonly 'settings.refresh.label': "自动刷新";
    readonly 'settings.refresh.off': "关闭";
    readonly 'settings.refresh.seconds': "{seconds} 秒";
    readonly 'settings.refresh.custom': "自定义";
    readonly 'settings.refresh.customUnit': "秒";
    readonly 'latency.title': "首字 {ttft} · 总耗时 {total}";
    readonly 'history.title': "{checkedAt} · {status}";
    readonly 'history.ok': "正常";
    readonly 'history.timeout': "超时";
    readonly 'history.failed': "{code}";
    readonly 'trend.expand': "展开全部";
    readonly 'trend.collapse': "收起";
    readonly 'trend.more': "更多";
    readonly 'trend.summary': "全部 {count} 次 · 均值 {avg} · 成功率 {percent}%";
    readonly 'trend.throughput': "吞吐 {value} tok/s";
    readonly 'edit.done': "完成设置";
    readonly 'edit.cancel': "取消";
};
/** English dictionary, key-identical to the Chinese source of truth. */
export declare const en: Record<ModelHealthKey, string>;
/** Key domain of the `modelHealth` namespace (zh is the source of truth). */
export type ModelHealthKey = keyof typeof zh;
