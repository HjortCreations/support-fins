import { LatestWorker } from "../worker-queue.js";
export const geometryQueue = new LatestWorker(
  new URL("../geometryworker.js", import.meta.url),
);
const tasks = new Map();
export const backgroundError = () => [...tasks.values()].some((t) => t.error);
export function reportTask(key, busy, error = null) {
  tasks.set(key, { busy, error });
  const field = document.getElementById("background-status");
  if (!field) return;
  const active = [...tasks.values()].some((t) => t.busy),
    failed = backgroundError();
  field.hidden = !active && !failed;
  document.getElementById("background-message").textContent = failed
    ? "Could not calculate supports. Please retry."
    : "Calculating in background…";
  document.getElementById("background-retry").hidden = !failed;
}
