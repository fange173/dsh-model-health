/**
 * Model-health status entry, browser half: mounts one status chip (sidebar
 * footer or conversation header, chosen in the panel's settings popover) that
 * auto-refreshes the model-health host plugin's local status JSON and presents a live
 * panel with per-model status and retained-round trends. All policy lives in
 * the controller and the pure view derivations; the component only composes.
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { ModelHealthController, type HealthPosition } from './controller.ts'
import {
  ModelHealthFooterAction,
  ModelHealthHeaderAction,
  type ModelHealthInjected,
} from './ModelHealthAction.tsx'
import { en, NS, zh, type ModelHealthKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Model-health status panel copy. */
    'modelHealth': ModelHealthKey
  }
}

export type { HealthViewProps, ModelHealthFooterActionProps } from './ModelHealthAction.tsx'

/** Required services for locale registration and slot contribution. */
export const inject = ['slots', 'locale']

/**
 * Client plugin body: register the dictionaries, start the auto-refresh controller,
 * and keep one chip mounted at the currently chosen position.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-health: dictionaries')
  const controller = new ModelHealthController()

  const injectFace = (): ModelHealthInjected => ({
    hooks: { health: controller.data, healthSettings: controller.settings },
    refresh: () => { void controller.refresh() },
    setPosition: (position: HealthPosition) => { controller.setPosition(position) },
    setRefreshSeconds: (seconds: number) => { controller.setRefreshSeconds(seconds) },
    syncFilter: (filter) => { void controller.syncFilter(filter) },
  })

  const mount = (position: HealthPosition): (() => void) =>
    position === 'sidebar'
      ? ctx.slots.inject(
        'sidebar.footer.action',
        () => ctx.slots.register({
          name: 'sidebar.footer.action',
          id: 'model-health',
          order: 40,
          locale: NS,
          inject: injectFace,
        }, ModelHealthFooterAction),
      )
      : ctx.slots.inject(
        'conversation.session.header.actions',
        () => ctx.slots.register({
          name: 'conversation.session.header.actions',
          id: 'model-health',
          order: 40,
          locale: NS,
          inject: injectFace,
        }, ModelHealthHeaderAction),
      )

  controller.start()

  let position = controller.settings.getSnapshot().position
  let disposeMount = mount(position)
  const unsubscribe = controller.settings.subscribe(() => {
    const next = controller.settings.getSnapshot().position
    if (next === position) return
    position = next
    disposeMount()
    disposeMount = mount(next)
  })

  ctx.effect(() => () => {
    unsubscribe()
    disposeMount()
    controller.dispose()
  }, 'model-health.lifecycle()')
}
