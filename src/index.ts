// Default to PST, overridable via TZ env var
process.env.TZ ??= "America/Los_Angeles";

import { createSlackAdapter } from "@chat-adapter/slack";
import { createRedisState } from "@chat-adapter/state-redis";
import { Chat } from "chat";
import { Elysia } from "elysia";
import { cleanOldLogs, pollPresence } from "./presence";
import {
  ensureCustomEmoji,
  generateAndPostReport,
  generateOnDemandReport,
} from "./report";

const bot = new Chat({
  userName: "activity-bot",
  adapters: {
    slack: createSlackAdapter(),
  },
  state: createRedisState(),
});

await bot.initialize();

// Poll presence every 1 minute
const POLL_INTERVAL = 60 * 1000;
setInterval(async () => {
  try {
    await pollPresence();
  } catch (err) {
    console.error("[scheduler] Presence poll failed:", err);
  }
}, POLL_INTERVAL);

// Check every minute if it's 10:00 AM to send the report
let lastReportDate = "";
setInterval(async () => {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const dateKey = now.toISOString().slice(0, 10);

  if (hour === 10 && minute === 0 && lastReportDate !== dateKey) {
    lastReportDate = dateKey;
    console.log("[scheduler] Triggering daily report...");
    try {
      await generateAndPostReport();
      // Clean logs older than 48 hours
      await cleanOldLogs(Math.floor(Date.now() / 1000) - 48 * 3600);
    } catch (err) {
      console.error("[scheduler] Report failed:", err);
    }
  }
}, 60 * 1000);

// Slash command: /porsche
bot.onSlashCommand("/porsche", async (event) => {
  const channelId = event.channel.id.split(":")[1] ?? "";
  await generateOnDemandReport(channelId);
});

// Check/upload custom emojis and run initial poll on startup
ensureCustomEmoji().catch((err) =>
  console.error("[startup] Emoji check failed:", err)
);
pollPresence().catch((err) =>
  console.error("[startup] Initial poll failed:", err)
);

new Elysia()
  .post("/api/webhooks/slack", ({ request }) => bot.webhooks.slack(request))
  .get("/", () => "Activity Bot Running")
  .listen(Number(process.env.PORT) || 3000);

console.log(`[bot] Activity bot running on port ${process.env.PORT || 3000}`);
console.log("[bot] Polling presence every 1 minute");
console.log("[bot] Daily report scheduled at 10:00 AM");
