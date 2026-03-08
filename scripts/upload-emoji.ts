/**
 * Bulk-uploads custom emoji PNGs to a Slack workspace.
 *
 * Usage: bun scripts/upload-emoji.ts
 */

import { readdirSync, readFileSync } from "node:fs";

const token =
  process.env.SLACK_USER_TOKEN ||
  (await new Promise<string>((resolve) => {
    console.log("You need a Slack user token (xoxp-...) to upload emojis.\n");
    console.log("To get one:");
    console.log(
      "  1. Go to https://api.slack.com/apps → select your app"
    );
    console.log(
      "  2. OAuth & Permissions → add the `admin` user scope"
    );
    console.log("  3. Reinstall to workspace");
    console.log("  4. Copy the User OAuth Token (starts with xoxp-)\n");
    process.stdout.write("Paste token: ");
    process.stdin.once("data", (data) => resolve(data.toString().trim()));
  }));

if (!token.startsWith("xoxp-")) {
  console.error("Token must start with xoxp-");
  process.exit(1);
}

const dir = "./emojis";
const files = readdirSync(dir).filter((f) => f.endsWith(".png"));

console.log(`Found ${files.length} emoji files to upload.\n`);

let uploaded = 0;
let skipped = 0;
let failed = 0;

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
    console.log(`  ✓ :${name}:`);
    uploaded++;
  } else if (json.error === "error_name_taken") {
    console.log(`  – :${name}: already exists`);
    skipped++;
  } else {
    console.log(`  ✗ :${name}: ${json.error}`);
    failed++;
  }

  // Rate limit: ~20 req/min for emoji.add
  await new Promise((r) => setTimeout(r, 3000));
}

console.log(
  `\nDone: ${uploaded} uploaded, ${skipped} skipped, ${failed} failed.`
);
