import type { Chat } from "chat";
import { fetchAllMembers, getPresenceLogs } from "./presence";

function getReportWindow(): { from: Date; to: Date } {
  const now = new Date();
  const to = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    10,
    0,
    0
  );
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);
  return { from, to };
}

// Must match scripts/setup-emoji.ts hourLabel()
function emojiHourLabel(h: number): string {
  if (h === 0) {
    return "12am";
  }
  if (h < 12) {
    return `${h}am`;
  }
  if (h === 12) {
    return "12pm";
  }
  return `${h - 12}pm`;
}

function getActivityEmoji(awayMinutes: number, hour: number): string {
  const h = emojiHourLabel(hour);
  if (awayMinutes <= 10) {
    return `:p-${h}-g:`;
  }
  if (awayMinutes <= 25) {
    return `:p-${h}-y:`;
  }
  return `:p-${h}-r:`;
}

function buildUserRow(
  userId: string,
  displayName: string,
  fromEpoch: number,
  startHour: number,
  hours: number
): string {
  const logs = getPresenceLogs(userId, fromEpoch, fromEpoch + hours * 3600);

  let blocks = "";
  for (let h = 0; h < hours; h++) {
    const hourStart = fromEpoch + h * 3600;
    const hourEnd = hourStart + 3600;
    const currentHour = (startHour + h) % 24;

    const hourLogs = logs.filter(
      (l) => l.timestamp >= hourStart && l.timestamp < hourEnd
    );

    if (hourLogs.length === 0) {
      blocks += `:p-${emojiHourLabel(currentHour)}-n:`;
      continue;
    }

    const awayCount = hourLogs.filter((l) => l.status === "away").length;
    const totalCount = hourLogs.length;
    const awayMinutes = Math.round((awayCount / totalCount) * 60);

    blocks += getActivityEmoji(awayMinutes, currentHour);
  }

  return `*${displayName}*\n${blocks}`;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function buildReport(
  from: Date,
  to: Date,
  hours: number,
  members: { id: string; realName: string }[]
): string {
  const fromEpoch = Math.floor(from.getTime() / 1000);
  const startHour = from.getHours();

  const fromStr = from.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const toStr = to.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  let report = `📊 *Activity Report*\n_${fromStr} ${formatTime(from)} → ${toStr} ${formatTime(to)}_\n\n`;
  report +=
    ":p-12pm-g: active  :p-12pm-y: partially away  :p-12pm-r: away  :p-12pm-n: no data\n\n";

  for (const member of members) {
    const row = buildUserRow(
      member.id,
      member.realName,
      fromEpoch,
      startHour,
      hours
    );
    report += `${row}\n\n`;
  }

  return report;
}

// Daily scheduled report: yesterday 10am → today 10am (24 hours)
export async function generateAndPostReport(bot: Chat) {
  const channelId = process.env.SLACK_REPORT_CHANNEL;
  if (!channelId) {
    console.error("[report] SLACK_REPORT_CHANNEL not set");
    return;
  }

  const { from, to } = getReportWindow();
  const members = await fetchAllMembers();
  if (members.length === 0) {
    console.log("[report] No members found, skipping report.");
    return;
  }

  const report = buildReport(from, to, 24, members);
  const channel = bot.channel(`slack:${channelId}`);
  await channel.post({ markdown: report });

  console.log(`[report] Posted daily report to ${channelId}`);
}

// On-demand report: last 24 completed hours
export async function generateOnDemandReport(bot: Chat, channelId: string) {
  const now = new Date();

  // End at the start of the current hour (exclude incomplete hour)
  const to = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    0,
    0
  );

  // Start 24 hours before that
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);

  const hours = 24;
  if (hours <= 0) {
    const channel = bot.channel(`slack:${channelId}`);
    await channel.post({ markdown: "No completed hours to report yet." });
    return;
  }

  const members = await fetchAllMembers();
  if (members.length === 0) {
    const channel = bot.channel(`slack:${channelId}`);
    await channel.post({ markdown: "No members found." });
    return;
  }

  const report = buildReport(from, to, hours, members);
  const channel = bot.channel(`slack:${channelId}`);
  await channel.post({ markdown: report });

  console.log(`[report] Posted on-demand report to ${channelId}`);
}
