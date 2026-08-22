/**
 * Model-health status entry, browser half: mounts one status chip (sidebar
 * footer or conversation header, chosen in the panel's settings popover) that
 * auto-refreshes the model-health host plugin's local status JSON and presents a live
 * panel with per-model status and retained-round trends. All policy lives in
 * the controller and the pure view derivations; the component only composes.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client';
import { type ModelHealthKey } from './locales.ts';
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface LocaleNamespaceMap {
        /** Model-health status panel copy. */
        'modelHealth': ModelHealthKey;
    }
}
export type { HealthViewProps, ModelHealthFooterActionProps } from './ModelHealthAction.tsx';
/** Required services for locale registration and slot contribution. */
export declare const inject: string[];
/**
 * Client plugin body: register the dictionaries, start the auto-refresh controller,
 * and keep one chip mounted at the currently chosen position.
 * @param ctx - client root context.
 */
export declare function apply(ctx: ClientContext): void;
