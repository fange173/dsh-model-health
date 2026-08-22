import type { ModelHealthFilter } from '../types.ts';
import type { SnapshotStore } from '@deepseek-ai/dsh-client-runtime/client';
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import { NS } from './locales.ts';
import type { HealthData, HealthPosition, HealthSettings } from './controller.ts';
/** Business face the apply world injects into the chip registration. */
export interface ModelHealthInjected {
    hooks: {
        health: SnapshotStore<HealthData>;
        healthSettings: SnapshotStore<HealthSettings>;
    };
    refresh: () => void;
    setPosition: (position: HealthPosition) => void;
    setRefreshSeconds: (seconds: number) => void;
    syncFilter: (filter: ModelHealthFilter) => void;
}
/** Shared props for the composed chip view: the injected face plus locale and the rail form. */
export type HealthViewProps = InjectFace<ModelHealthInjected> & PropsLocale<typeof NS> & {
    readonly narrowLabel?: boolean;
    readonly fullWidth?: boolean;
};
/** Sidebar-footer seat: consumes the column's `wide` owner flag to adapt the chip. */
export type ModelHealthFooterActionProps = PropsRuntime<'sidebar.footer.action'> & HealthViewProps;
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
export declare function ModelHealthFooterAction({ wide, useHealth, useHealthSettings, refresh, setPosition, setRefreshSeconds, syncFilter, t, }: ModelHealthFooterActionProps): import("react").JSX.Element;
/**
 * Conversation-header registration seat: always roomy enough for the full
 * chip, so it renders the default form.
 * @param props - injected face and locale (the header's own props are unused).
 */
export declare function ModelHealthHeaderAction(props: HealthViewProps): import("react").JSX.Element;
