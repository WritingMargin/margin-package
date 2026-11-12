const executionActions = [
  "session.create",
  "cell.execute",
  "session.interrupt",
  "session.restart",
  "session.heartbeat",
  "session.close",
];
export const connectionHint =
  "Connect a Python service in this plugin’s settings to run cells.";
export function executionAvailable(context) {
  if (context.mode === "read") return false;
  return (
    Array.isArray(context.actions) &&
    executionActions.every((action) => context.actions.includes(action))
  );
}
export function executionHint(context) {
  if (context.mode === "read") return "";
  if (!executionAvailable(context)) return connectionHint;
  return context.mode === "edit"
    ? "Runs are temporary until you choose Save outputs."
    : "Private Python execution. Saved notebook data is unchanged.";
}
