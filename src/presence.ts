import { WebClient } from "@slack/web-api";
import { createClient } from "redis";

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

const REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
const PRESENCE_USER_SET_KEY = "presence:users";
const PRESENCE_LOG_KEY_PREFIX = "presence:logs:";

type PresenceRedisClient = ReturnType<typeof createClient>;

let redisClient: PresenceRedisClient | null = null;
let redisConnectPromise: Promise<PresenceRedisClient | null> | null = null;

function getPresenceLogKey(userId: string): string {
  return `${PRESENCE_LOG_KEY_PREFIX}${userId}`;
}

async function getRedisClient(): Promise<PresenceRedisClient | null> {
  if (redisClient?.isOpen) {
    return redisClient;
  }

  if (!redisConnectPromise) {
    redisConnectPromise = (async () => {
      try {
        const client = createClient({ url: REDIS_URL });
        client.on("error", (err) => {
          console.error("[presence] Redis error:", err);
        });
        await client.connect();
        redisClient = client;
        return client;
      } catch (err) {
        console.error("[presence] Failed to connect to Redis:", err);
        return null;
      }
    })();
  }

  return redisConnectPromise;
}

export async function getPresenceLogs(
  userId: string,
  fromEpoch: number,
  toEpoch: number
): Promise<PresenceEntry[]> {
  const client = await getRedisClient();
  if (!client) {
    return [];
  }

  const entries = await client.zRangeByScore(
    getPresenceLogKey(userId),
    fromEpoch,
    `(${toEpoch}`
  );
  const logs: PresenceEntry[] = [];
  for (const entry of entries) {
    try {
      logs.push(JSON.parse(entry) as PresenceEntry);
    } catch {
      // Skip malformed entries
    }
  }
  return logs;
}

export async function cleanOldLogs(olderThanEpoch: number) {
  const client = await getRedisClient();
  if (!client) {
    return;
  }

  const userIds = await client.sMembers(PRESENCE_USER_SET_KEY);
  for (const userId of userIds) {
    const key = getPresenceLogKey(userId);
    await client.zRemRangeByScore(key, "-inf", `(${olderThanEpoch}`);
    const remaining = await client.zCard(key);
    if (remaining === 0) {
      await client.del(key);
      await client.sRem(PRESENCE_USER_SET_KEY, userId);
    }
  }
}

async function logPresence(userId: string, status: string) {
  const client = await getRedisClient();
  if (!client) {
    return;
  }

  const entry: PresenceEntry = {
    timestamp: Math.floor(Date.now() / 1000),
    status,
  };

  const key = getPresenceLogKey(userId);
  await client.sAdd(PRESENCE_USER_SET_KEY, userId);
  await client.zAdd(key, {
    score: entry.timestamp,
    value: JSON.stringify(entry),
  });
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
      await logPresence(member.id, res.presence ?? "away");
    } catch (err) {
      console.error(
        `[presence] Failed to get presence for ${member.name}:`,
        err
      );
    }
  }

  console.log("[presence] Poll complete.");
}
