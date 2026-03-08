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

function getActivityEmoji(awayMinutes: number): string {
  if (awayMinutes <= 10) {
    return "🟩";
  }
  if (awayMinutes <= 25) {
    return "🟨";
  }
  return "🟥";
}

function formatHourLabel(hour: number): string {
  if (hour === 0) {
    return "12a";
  }
  if (hour < 12) {
    return `${hour}a`;
  }
  if (hour === 12) {
    return "12p";
  }
  return `${hour - 12}p`;
}

function buildUserRow(
  userId: string,
  displayName: string,
  fromEpoch: number,
  hours: number
): string {
  const logs = getPresenceLogs(userId, fromEpoch, fromEpoch + hours * 3600);

  let blocks = "";
  for (let h = 0; h < hours; h++) {
    const hourStart = fromEpoch + h * 3600;
    const hourEnd = hourStart + 3600;

    const hourLogs = logs.filter(
      (l) => l.timestamp >= hourStart && l.timestamp < hourEnd
    );

    if (hourLogs.length === 0) {
      blocks += "⬜";
      continue;
    }

    const awayCount = hourLogs.filter((l) => l.status === "away").length;
    const totalCount = hourLogs.length;
    const awayMinutes = Math.round((awayCount / totalCount) * 60);

    blocks += getActivityEmoji(awayMinutes);
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

  // Build hour labels
  const labels: string[] = [];
  for (let h = 0; h < hours; h++) {
    const hour = (startHour + h) % 24;
    labels.push(formatHourLabel(hour));
  }
  const labelRow = labels
    .map((l, i) => (i % 2 === 0 ? l.padEnd(2) : ""))
    .join("");

  let report = `📊 *Activity Report*\n_${fromStr} ${formatTime(from)} → ${toStr} ${formatTime(to)}_\n\n`;
  report += "🟩 active  🟨 partially away  🟥 away  ⬜ no data\n";
  report += `\`${labelRow}\`\n\n`;

  for (const member of members) {
    const row = buildUserRow(member.id, member.realName, fromEpoch, hours);
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
