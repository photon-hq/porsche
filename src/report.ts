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
  toEpoch: number
): string {
  const logs = getPresenceLogs(userId, fromEpoch, toEpoch);

  let blocks = "";
  for (let h = 0; h < 24; h++) {
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

export async function generateAndPostReport(bot: Chat) {
  const channelId = process.env.SLACK_REPORT_CHANNEL;
  if (!channelId) {
    console.error("[report] SLACK_REPORT_CHANNEL not set");
    return;
  }

  const { from, to } = getReportWindow();
  const fromEpoch = Math.floor(from.getTime() / 1000);
  const toEpoch = Math.floor(to.getTime() / 1000);

  const members = await fetchAllMembers();
  if (members.length === 0) {
    console.log("[report] No members found, skipping report.");
    return;
  }

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
  for (let h = 0; h < 24; h++) {
    const hour = (10 + h) % 24;
    labels.push(formatHourLabel(hour));
  }
  // Show labels every 2 hours for readability
  const labelRow = labels
    .map((l, i) => (i % 2 === 0 ? l.padEnd(2) : ""))
    .join("");

  let report = `📊 *Daily Activity Report*\n_${fromStr} 10:00 AM → ${toStr} 10:00 AM_\n\n`;
  report += "🟩 active  🟨 partially away  🟥 away  ⬜ no data\n";
  report += `\`${labelRow}\`\n\n`;

  for (const member of members) {
    const row = buildUserRow(member.id, member.realName, fromEpoch, toEpoch);
    report += `${row}\n\n`;
  }

  const channel = bot.channel(`slack:${channelId}`);
  await channel.post({ markdown: report });

  console.log(`[report] Posted activity report to ${channelId}`);
}
