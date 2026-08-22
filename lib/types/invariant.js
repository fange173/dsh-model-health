const PACKAGE_NAME = "dsh-model-health";
const name = "model-health-invariant";
const inject = ["invariants"];
const install = () => {
};
const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
export {
  apply,
  inject,
  name
};
