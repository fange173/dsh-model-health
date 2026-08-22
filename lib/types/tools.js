import { defineTool } from "@deepseek-ai/dsh-tools";
const MODEL_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    provider: { type: "string", required: true },
    model: { type: "string", required: true },
    name: { type: "string", required: true },
    checkedAt: { type: "string", required: true },
    ok: { type: "boolean", required: true },
    ttftMs: { type: "number" },
    totalMs: { type: "number" },
    error: {
      type: "object",
      additionalProperties: false,
      properties: {
        code: { type: "string", required: true },
        message: { type: "string", required: true },
        status: { type: "integer" }
      }
    }
  }
};
const SNAPSHOT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    checkedAt: { type: "string" },
    models: { type: "array", required: true, items: MODEL_RESULT_SCHEMA }
  }
};
const DESCRIPTION = "Report the latest connectivity and latency check for every model currently registered with a provider. Each result carries ok, time-to-first-token and total round-trip latency in milliseconds, the check timestamp, and the error code/status when the check failed. Set refresh true to run a fresh check of every model now instead of returning the latest results.";
function registerModelHealthTool(ctx, deps) {
  return ctx.tools.register(defineTool({
    name: "model_status",
    description: DESCRIPTION,
    parameters: {
      refresh: {
        type: "boolean",
        description: "When true, probe every registered model now and return those results; may take several seconds per model."
      }
    },
    output: jsonOutput(SNAPSHOT_SCHEMA),
    async execute(args, _exec) {
      if (args.refresh === true || deps.store.isEmpty()) {
        await deps.runNow();
      }
      return deps.store.snapshot();
    },
    presentCall: (args) => ({
      card: "generic",
      title: args.refresh === true ? "Check model status" : "Model status",
      kind: "read"
    })
  }));
}
function jsonOutput(schema) {
  return {
    schema,
    render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }]
  };
}
export {
  registerModelHealthTool
};
