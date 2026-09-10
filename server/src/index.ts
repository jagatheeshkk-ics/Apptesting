import { buildApp } from "./app.js";
import { prisma } from "./db.js";

const app = await buildApp();

// Every test run in progress is tracked only in this process's memory (the
// browser/context, the cancellation flag, etc.) — a restart (a deploy, a
// crash, Render recycling the dyno) kills all of that without a chance to
// write a final status, leaving the DB row stuck showing "executing" (or,
// worse, "cancelling" forever if a stop was requested right before the
// restart, since nothing is left running to notice the request). Reconcile
// on boot: nothing still "cancelling" can ever finish cancelling itself, so
// call it done; nothing still pending/crawling/generating/executing can
// possibly still be running, so call it failed with a clear reason instead
// of leaving it looking perpetually in-progress.
async function reconcileOrphanedRuns(): Promise<void> {
  try {
    const cancelled = await prisma.testRun.updateMany({
      where: { status: "cancelling" },
      data: { status: "cancelled", completedAt: new Date() },
    });
    const failed = await prisma.testRun.updateMany({
      where: { status: { in: ["pending", "crawling", "generating", "executing"] } },
      data: {
        status: "failed",
        error: "This run was interrupted by a server restart (e.g. a deploy) and could not continue.",
        completedAt: new Date(),
      },
    });
    if (cancelled.count || failed.count) {
      app.log.warn(
        `Reconciled ${cancelled.count} orphaned "cancelling" run(s) to "cancelled" and ${failed.count} orphaned in-progress run(s) to "failed" on startup.`,
      );
    }
  } catch (err) {
    app.log.warn(err, "failed to reconcile orphaned test runs on startup");
  }
}
await reconcileOrphanedRuns();

const port = Number(process.env.PORT ?? 4000);
app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
