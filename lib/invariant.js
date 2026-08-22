//#region lib/types/invariant.js
/** Package-owned invariant companion for the model-health plugin. */
const PACKAGE_NAME = "dsh-model-health";
/** Cordis companion plugin name. */
const name = "model-health-invariant";
/** Invariant registry dependency. */
const inject = ["invariants"];
/**
* No runtime invariant: the llm registry owns provider/model registration
* relations, and this plugin holds only disposable latency projections.
*/
const install = () => {};
/** Register this package's invariant ownership. */
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
//#endregion
export { apply, inject, name };

//# sourceMappingURL=invariant.js.map