// Runs once per server start. Node-only side effects live behind the runtime check.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { registerOwnerNotifications } = await import("./lib/notifications");
    registerOwnerNotifications();
  }
}
