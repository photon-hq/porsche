import { WebClient } from "@slack/web-api";

const slack = new WebClient(process.env.SLACK_BOT_TOKEN);

export interface PresenceEntry {
  status: string;
  timestamp: number;
}

export interface Member {
  id: string;
  name: string;
  realName: string;
}

// In-memory presence store: userId -> entries
const presenceStore = new Map<string, PresenceEntry[]>();

export function getPresenceLogs(
  userId: string,
  fromEpoch: number,
  toEpoch: number
): PresenceEntry[] {
  const entries = presenceStore.get(userId);
  if (!entries) {
    return [];
  }
  return entries.filter(
    (e) => e.timestamp >= fromEpoch && e.timestamp < toEpoch
  );
}

export function cleanOldLogs(olderThanEpoch: number) {
  for (const [userId, entries] of presenceStore) {
    const filtered = entries.filter((e) => e.timestamp >= olderThanEpoch);
    if (filtered.length === 0) {
      presenceStore.delete(userId);
    } else {
      presenceStore.set(userId, filtered);
    }
  }
}

function logPresence(userId: string, status: string) {
  const entry: PresenceEntry = {
    timestamp: Math.floor(Date.now() / 1000),
    status,
  };
  const entries = presenceStore.get(userId);
  if (entries) {
    entries.push(entry);
  } else {
    presenceStore.set(userId, [entry]);
  }
}

let cachedMembers: Member[] | null = null;
let membersCachedAt = 0;
const MEMBER_CACHE_TTL = 1000 * 60 * 60; // 1 hour

export async function fetchAllMembers(): Promise<Member[]> {
  if (cachedMembers && Date.now() - membersCachedAt < MEMBER_CACHE_TTL) {
    return cachedMembers;
  }

  const members: Member[] = [];
  let cursor: string | undefined;

  do {
    const res = await slack.users.list({ cursor, limit: 200 });
    for (const user of res.members ?? []) {
      if (
        user.id &&
        !user.deleted &&
        !user.is_bot &&
        !user.is_app_user &&
        !user.is_restricted && // single-channel guest
        !user.is_ultra_restricted && // multi-channel guest
        user.id !== "USLACKBOT"
      ) {
        members.push({
          id: user.id,
          name: user.name ?? user.id,
          realName: user.real_name ?? user.name ?? user.id,
        });
      }
    }
    cursor = res.response_metadata?.next_cursor || undefined;
  } while (cursor);

  cachedMembers = members;
  membersCachedAt = Date.now();
  return members;
}

export async function pollPresence() {
  const members = await fetchAllMembers();
  console.log(`[presence] Polling ${members.length} members...`);

  for (const member of members) {
    try {
      const res = await slack.users.getPresence({ user: member.id });
      logPresence(member.id, res.presence ?? "away");
    } catch (err) {
      console.error(
        `[presence] Failed to get presence for ${member.name}:`,
        err
      );
    }
  }

  console.log("[presence] Poll complete.");
}
