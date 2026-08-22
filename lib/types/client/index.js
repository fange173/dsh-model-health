import { ModelHealthController } from "./controller.js";
import { ModelHealthFooterAction, ModelHealthHeaderAction, } from "./ModelHealthAction.js";
import { en, NS, zh } from "./locales.js";
/** Required services for locale registration and slot contribution. */
export const inject = ['slots', 'locale'];
/**
 * Client plugin body: register the dictionaries, start the auto-refresh controller,
 * and keep one chip mounted at the currently chosen position.
 * @param ctx - client root context.
 */
export function apply(ctx) {
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'model-health: dictionaries');
    const controller = new ModelHealthController();
    const injectFace = () => ({
        hooks: { health: controller.data, healthSettings: controller.settings },
        refresh: () => { void controller.refresh(); },
        setPosition: (position) => { controller.setPosition(position); },
        setRefreshSeconds: (seconds) => { controller.setRefreshSeconds(seconds); },
        syncFilter: (filter) => { void controller.syncFilter(filter); },
    });
    const mount = (position) => position === 'sidebar'
        ? ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
            name: 'sidebar.footer.action',
            id: 'model-health',
            order: 40,
            locale: NS,
            inject: injectFace,
        }, ModelHealthFooterAction))
        : ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
            name: 'conversation.session.header.actions',
            id: 'model-health',
            order: 40,
            locale: NS,
            inject: injectFace,
        }, ModelHealthHeaderAction));
    controller.start();
    let position = controller.settings.getSnapshot().position;
    let disposeMount = mount(position);
    const unsubscribe = controller.settings.subscribe(() => {
        const next = controller.settings.getSnapshot().position;
        if (next === position)
            return;
        position = next;
        disposeMount();
        disposeMount = mount(next);
    });
    ctx.effect(() => () => {
        unsubscribe();
        disposeMount();
        controller.dispose();
    }, 'model-health.lifecycle()');
}
//# sourceMappingURL=index.js.map