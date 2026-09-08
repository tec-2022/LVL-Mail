import { listRegisteredApps } from "@/lib/app-registry";
import { evaluateReliability } from "@/lib/operations";

export async function sweepReliabilityFleet(limit = 500) {
  const apps = (await listRegisteredApps()).slice(0, Math.max(1, Math.min(limit, 5000)));
  const results = await Promise.allSettled(apps.map(async (app) => {
    await evaluateReliability(app.id);
    return app.id;
  }));
  return {
    evaluated: results.filter((result) => result.status === "fulfilled").length,
    failed: results.filter((result) => result.status === "rejected").length,
    total: apps.length,
  };
}
