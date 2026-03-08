import { readdirSync, readFileSync } from "node:fs";
import { WebClient } from "@slack/web-api";
import { fetchAllMembers, getPresenceLogs } from "./presence";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

// Checked once on first report
let useCustomEmoji: boolean | null = null;

async function uploadEmojis(token: string): Promise<number> {
  const dir = "./emojis";
  let files: string[];
  try {
    files = readdirSync(dir).filter((f) => f.endsWith(".png"));
  } catch {
    console.error("[emoji] emojis/ directory not found, skipping upload.");
    return 0;
  }

  let uploaded = 0;
  for (const file of files) {
    const name = file.replace(".png", "");
    const data = readFileSync(`${dir}/${file}`);
    const blob = new Blob([data], { type: "image/png" });

    const form = new FormData();
    form.append("token", token);
    form.append("name", name);
    form.append("mode", "data");
    form.append("image", blob, file);

    const res = await fetch("https://slack.com/api/emoji.add", {
      method: "POST",
      body: form,
    });
    const json = (await res.json()) as { ok: boolean; error?: string };

    if (json.ok) {
      uploaded++;
    } else if (json.error !== "error_name_taken") {
      console.error(`[emoji] Failed to upload :${name}:: ${json.error}`);
    }

    // Rate limit: ~20 req/min
    await new Promise((r) => setTimeout(r, 3000));
  }
  return uploaded;
}

async function ensureCustomEmoji(): Promise<boolean> {
  if (useCustomEmoji !== null) {
    return useCustomEmoji;
  }

  // Check if emojis already exist
  try {
    const res = await slack.emoji.list();
    if (res.emoji?.["p-12pm-g"]) {
      useCustomEmoji = true;
      return true;
    }
  } catch {
    // Can't check — fall through
  }

  // Try auto-upload if user token is available
  const userToken = process.env.SLACK_USER_TOKEN;
  if (userToken) {
    console.log("[emoji] Custom emojis not found, uploading...");
    const count = await uploadEmojis(userToken);
    if (count > 0) {
      console.log(`[emoji] Uploaded ${count} emojis.`);
      useCustomEmoji = true;
      return true;
    }
  }

  useCustomEmoji = false;
  console.log(
    "[report] Custom emojis not found, using Unicode fallback. Set SLACK_USER_TOKEN to auto-upload."
  );
  return false;
}

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

const UNICODE_EMOJI = {
  g: "🟩",
  y: "🟨",
  r: "🟥",
  n: "⬜",
} as const;

function getHourSuffix(awayMinutes: number): "g" | "y" | "r" {
  if (awayMinutes <= 10) {
    return "g";
  }
  if (awayMinutes <= 25) {
    return "y";
  }
  return "r";
}

function buildUserRow(
  userId: string,
  fromEpoch: number,
  startHour: number,
  hours: number,
  custom: boolean
): string {
  const logs = getPresenceLogs(userId, fromEpoch, fromEpoch + hours * 3600);

  const emojis: string[] = [];
  for (let h = 0; h < hours; h++) {
    const hourStart = fromEpoch + h * 3600;
    const hourEnd = hourStart + 3600;
    const label = emojiHourLabel((startHour + h) % 24);

    const hourLogs = logs.filter(
      (l) => l.timestamp >= hourStart && l.timestamp < hourEnd
    );

    if (hourLogs.length === 0) {
      emojis.push(custom ? `:p-${label}-n:` : UNICODE_EMOJI.n);
      continue;
    }

    const awayCount = hourLogs.filter((l) => l.status === "away").length;
    const awayMinutes = Math.round((awayCount / hourLogs.length) * 60);
    const suffix = getHourSuffix(awayMinutes);
    emojis.push(custom ? `:p-${label}-${suffix}:` : UNICODE_EMOJI[suffix]);
  }

  return emojis.join("");
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
  members: { id: string; realName: string }[],
  custom: boolean
): string {
  const fromStr = from.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
  const toStr = to.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const fromEpoch = Math.floor(from.getTime() / 1000);
  const startHour = from.getHours();

  const lines: string[] = [];
  lines.push(
    `📊 *Activity Report*\n_${fromStr} ${formatTime(from)} → ${toStr} ${formatTime(to)}_`
  );
  lines.push("");

  if (custom) {
    lines.push(
      ":p-12pm-g: active  :p-12pm-y: partially away  :p-12pm-r: away  :p-12pm-n: no data"
    );
  } else {
    lines.push("🟩 active  🟨 partially away  🟥 away  ⬜ no data");
  }

  for (const member of members) {
    lines.push("");
    lines.push(`*${member.realName}*`);
    lines.push(buildUserRow(member.id, fromEpoch, startHour, hours, custom));
  }

  return lines.join("\n");
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

  const custom = await ensureCustomEmoji();
  const text = buildReport(from, to, 24, members, custom);
  await slack.chat.postMessage({
    channel: channelId,
    text,
  });
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

  const custom = await ensureCustomEmoji();
  const text = buildReport(from, to, 24, members, custom);
  await slack.chat.postMessage({
    channel: channelId,
    text,
  });
  console.log(`[report] Posted on-demand report to ${channelId}`);
}
