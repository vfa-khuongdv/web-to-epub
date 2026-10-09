// Turns the short-lived user token from Graph API Explorer into a Page access token that
// does not expire, for Settings → Facebook. Nothing is saved: the Page id and token are
// printed, and you paste them into the app. Secrets are typed hidden, so they stay out of
// the shell history.
//
//   node scripts/facebook-token.js
//
// Needs the app's id and secret (developers.facebook.com → App settings → Basic) and the
// short-lived user token, generated with publish_video, pages_manage_posts,
// pages_show_list and pages_read_engagement while choosing your Page.
const readline = require("readline");

const GRAPH = "https://graph.facebook.com/v21.0";

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    if (hidden) {
      rl._writeToOutput = (text) => {
        if (text.startsWith(question)) rl.output.write(question);
      };
    }
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(answer.trim());
    });
  });
}

async function graph(path, params) {
  const res = await fetch(`${GRAPH}${path}?${new URLSearchParams(params)}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body;
}

async function main() {
  const appId = await ask("App ID: ");
  const appSecret = await ask("App Secret (hidden): ", { hidden: true });
  const shortToken = await ask("Short-lived user token (hidden): ", { hidden: true });
  if (!appId || !appSecret || !shortToken) throw new Error("App ID, App Secret and the user token are all required.");

  const long = await graph("/oauth/access_token", {
    grant_type: "fb_exchange_token",
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const pages = (await graph("/me/accounts", { access_token: long.access_token, limit: "100" })).data ?? [];
  if (pages.length === 0) {
    throw new Error(
      "No Pages came back. Generate the token again and tick your Page when Facebook asks which Pages to allow (pages_show_list)."
    );
  }

  pages.forEach((page, index) => console.log(`${index + 1}. ${page.name} (${page.id})`));
  const choice = pages.length === 1 ? 1 : Number(await ask("Which Page? number: "));
  const page = pages[choice - 1];
  if (!page) throw new Error("That is not one of the listed Pages.");

  const info = (
    await graph("/debug_token", { input_token: page.access_token, access_token: `${appId}|${appSecret}` })
  ).data;
  console.log(`\nPage:    ${page.name}`);
  console.log(`Page id: ${page.id}`);
  console.log(`Expires: ${info.expires_at ? new Date(info.expires_at * 1000).toISOString() : "never"}`);
  console.log(`Scopes:  ${(info.scopes ?? []).join(", ")}`);
  console.log(`\nPage access token (paste into Settings → Facebook):\n${page.access_token}`);
}

main().catch((err) => {
  console.error(`\n${err.message}`);
  process.exit(1);
});
