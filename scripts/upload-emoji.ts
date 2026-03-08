/**
 * Creates emoji aliases for the activity report in your Slack workspace.
 * Creates 96 aliases (24 hours × 4 states) like :p-6pm-g: → :large_green_square:
 *
 * Usage: bun scripts/upload-emoji.ts
 */

const ALIAS_MAP: Record<string, string> = {
  g: "large_green_square",
  y: "large_yellow_square",
  r: "large_red_square",
  n: "white_large_square",
};

function hourLabel(h: number): string {
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

function prompt(msg: string): Promise<string> {
  return new Promise((resolve) => {
    process.stdout.write(msg);
    process.stdin.once("data", (data) => resolve(data.toString().trim()));
  });
}

console.log(
  "This script creates emoji aliases for the Porsche activity report."
);
console.log("You'll need to grab two values from your browser.\n");

console.log("Step 1: Get your API token");
console.log("  → Open your Slack workspace in a browser (app.slack.com)");
console.log("  → DevTools (F12) → Console → paste this:");
console.log("");
console.log(
  "    JSON.parse(localStorage.localConfig_v2).teams[Object.keys(JSON.parse(localStorage.localConfig_v2).teams)[0]].token"
);
console.log("");

const token = await prompt("Paste token (xoxc-...): ");
if (!token.startsWith("xoxc-")) {
  console.error("Token must start with xoxc-");
  process.exit(1);
}

console.log("\nStep 2: Get your session cookie");
console.log("  → DevTools → Application tab → Cookies → https://app.slack.com");
console.log('  → Find the cookie named "d" (value starts with xoxd-)');
console.log("");

const cookie = await prompt("Paste d cookie value: ");
if (!cookie.startsWith("xoxd-")) {
  console.error("Cookie must start with xoxd-");
  process.exit(1);
}

// Build all aliases
const aliases: { name: string; aliasFor: string }[] = [];
for (let h = 0; h < 24; h++) {
  const label = hourLabel(h);
  for (const [suffix, target] of Object.entries(ALIAS_MAP)) {
    aliases.push({ name: `p-${label}-${suffix}`, aliasFor: target });
  }
}

console.log(`\nCreating ${aliases.length} emoji aliases...\n`);

let created = 0;
let skipped = 0;
let failed = 0;

for (const { name, aliasFor } of aliases) {
  // Retry loop for rate limiting (429)
  let json: { ok: boolean; error?: string } = { ok: false };
  while (true) {
    const form = new FormData();
    form.append("token", token);
    form.append("name", name);
    form.append("mode", "alias");
    form.append("alias_for", aliasFor);

    const res = await fetch("https://slack.com/api/emoji.add", {
      method: "POST",
      headers: { Cookie: `d=${cookie}` },
      body: form,
    });

    if (res.status === 429) {
      const retryAfter = Number(res.headers.get("retry-after")) || 2;
      console.log(`  Rate limited, waiting ${retryAfter}s...`);
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      continue;
    }

    json = (await res.json()) as { ok: boolean; error?: string };
    break;
  }

  if (json.ok) {
    console.log(`  ✓ :${name}: → :${aliasFor}:`);
    created++;
  } else if (json.error === "error_name_taken") {
    console.log(`  – :${name}: already exists`);
    skipped++;
  } else {
    console.log(`  ✗ :${name}: ${json.error}`);
    failed++;
  }
}

console.log(
  `\nDone: ${created} created, ${skipped} skipped, ${failed} failed.`
);
