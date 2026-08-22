function targetKey(provider, model) {
  return `${provider}/${model}`;
}
const EMPTY_FILTER = {};
const MAX_FILTER_ENTRIES = 256;
const MAX_FILTER_KEY_LENGTH = 200;
function sanitizeFilterInput(value) {
  if (value === null || typeof value !== "object") return {};
  const raw = value;
  const providers = sanitizeList(raw.disabledProviders);
  const models = sanitizeList(raw.disabledModels);
  return {
    ...providers.length > 0 ? { disabledProviders: providers } : {},
    ...models.length > 0 ? { disabledModels: models } : {}
  };
}
function sanitizeList(value) {
  if (!Array.isArray(value)) return [];
  const out = [];
  for (const entry of value) {
    if (out.length >= MAX_FILTER_ENTRIES) break;
    if (typeof entry !== "string" || entry.length === 0 || entry.length > MAX_FILTER_KEY_LENGTH) continue;
    out.push(entry);
  }
  return out;
}
function isModelEnabled(filter, provider, model) {
  if (filter.disabledProviders?.includes(provider)) return false;
  return !filter.disabledModels?.includes(targetKey(provider, model));
}
function filterTargets(targets, filter) {
  return targets.filter((target) => isModelEnabled(filter, target.provider, target.model));
}
function setProviderEnabled(filter, provider, enabled) {
  return enabled ? remove(filter, "disabledProviders", provider) : add(filter, "disabledProviders", provider);
}
function setModelEnabled(filter, provider, model, enabled) {
  const key = targetKey(provider, model);
  return enabled ? remove(filter, "disabledModels", key) : add(filter, "disabledModels", key);
}
function add(filter, field, value) {
  const prev = filter[field];
  if (prev?.includes(value)) return filter;
  return { ...filter, [field]: [...prev ?? [], value] };
}
function remove(filter, field, value) {
  const prev = filter[field];
  if (prev === void 0) return filter;
  const next = prev.filter((entry) => entry !== value);
  return next.length === prev.length ? filter : { ...filter, [field]: next };
}
export {
  EMPTY_FILTER,
  MAX_FILTER_ENTRIES,
  MAX_FILTER_KEY_LENGTH,
  filterTargets,
  isModelEnabled,
  sanitizeFilterInput,
  setModelEnabled,
  setProviderEnabled,
  targetKey
};
