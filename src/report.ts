import type { KnownBlock } from "@slack/web-api";
import { WebClient } from "@slack/web-api";
import { fetchAllMembers, getPresenceLogs } from "./presence";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);
const APP_URL =
  process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;

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

interface HourStatus {
  label: string;
  suffix: string;
}

function getHourStatus(awayMinutes: number): HourStatus {
  if (awayMinutes <= 10) {
    return { suffix: "g", label: "active" };
  }
  if (awayMinutes <= 25) {
    return { suffix: "y", label: "partially away" };
  }
  return { suffix: "r", label: "away" };
}

function imageEl(hourLabel: string, suffix: string, altText: string) {
  return {
    type: "image" as const,
    image_url: `${APP_URL}/emoji/p-${hourLabel}-${suffix}.png`,
    alt_text: altText,
  };
}

function buildUserBlocks(
  userId: string,
  displayName: string,
  fromEpoch: number,
  startHour: number,
  hours: number
): KnownBlock[] {
  const logs = getPresenceLogs(userId, fromEpoch, fromEpoch + hours * 3600);

  const images: ReturnType<typeof imageEl>[] = [];
  for (let h = 0; h < hours; h++) {
    const hourStart = fromEpoch + h * 3600;
    const hourEnd = hourStart + 3600;
    const currentHour = (startHour + h) % 24;
    const label = emojiHourLabel(currentHour);

    const hourLogs = logs.filter(
      (l) => l.timestamp >= hourStart && l.timestamp < hourEnd
    );

    if (hourLogs.length === 0) {
      images.push(imageEl(label, "n", `${label} — no data`));
      continue;
    }

    const awayCount = hourLogs.filter((l) => l.status === "away").length;
    const totalCount = hourLogs.length;
    const awayMinutes = Math.round((awayCount / totalCount) * 60);
    const status = getHourStatus(awayMinutes);
    images.push(imageEl(label, status.suffix, `${label} — ${status.label}`));
  }

  // Split into context blocks (max 10 elements each)
  // First block: name + up to 9 images
  const blocks: KnownBlock[] = [];
  blocks.push({
    type: "context",
    elements: [
      { type: "mrkdwn", text: `*${displayName}*` },
      ...images.slice(0, 9),
    ],
  });

  for (let i = 9; i < images.length; i += 10) {
    blocks.push({
      type: "context",
      elements: images.slice(i, i + 10),
    });
  }

  return blocks;
}

function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function buildBlocks(
  from: Date,
  to: Date,
  hours: number,
  members: { id: string; realName: string }[]
): KnownBlock[] {
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

  const blocks: KnownBlock[] = [];

  // Header
  blocks.push({
    type: "section",
    text: {
      type: "mrkdwn",
      text: `📊 *Activity Report*\n_${fromStr} ${formatTime(from)} → ${toStr} ${formatTime(to)}_`,
    },
  });

  // Legend
  blocks.push({
    type: "context",
    elements: [
      imageEl("12pm", "g", "active"),
      { type: "mrkdwn", text: "active" },
      imageEl("12pm", "y", "partially away"),
      { type: "mrkdwn", text: "partially away" },
      imageEl("12pm", "r", "away"),
      { type: "mrkdwn", text: "away" },
      imageEl("12pm", "n", "no data"),
      { type: "mrkdwn", text: "no data" },
    ],
  });

  // User rows
  for (const member of members) {
    blocks.push(
      ...buildUserBlocks(
        member.id,
        member.realName,
        fromEpoch,
        startHour,
        hours
      )
    );
  }

  return blocks;
}

async function postReport(channelId: string, blocks: KnownBlock[]) {
  // Block Kit has a 50-block limit per message; split if needed
  const MAX_BLOCKS = 50;
  for (let i = 0; i < blocks.length; i += MAX_BLOCKS) {
    await slack.chat.postMessage({
      channel: channelId,
      blocks: blocks.slice(i, i + MAX_BLOCKS),
      text: "Activity Report",
    });
  }
}

// Daily scheduled report: yesterday 10am → today 10am (24 hours)
export async function generateAndPostReport() {
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

  const blocks = buildBlocks(from, to, 24, members);
  await postReport(channelId, blocks);
  console.log(`[report] Posted daily report to ${channelId}`);
}

// On-demand report: last 24 completed hours
export async function generateOnDemandReport(channelId: string) {
  const now = new Date();

  const to = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
    now.getHours(),
    0,
    0
  );
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);

  const members = await fetchAllMembers();
  if (members.length === 0) {
    await slack.chat.postMessage({
      channel: channelId,
      text: "No members found.",
    });
    return;
  }

  const blocks = buildBlocks(from, to, 24, members);
  await postReport(channelId, blocks);
  console.log(`[report] Posted on-demand report to ${channelId}`);
}
