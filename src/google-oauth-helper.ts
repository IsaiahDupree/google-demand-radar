import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { exec } from "node:child_process";

interface ClientSecretFile {
  installed?: { client_id: string; client_secret: string };
  web?: { client_id: string; client_secret: string };
}

const SCOPE = "https://www.googleapis.com/auth/adwords";

async function main(): Promise<void> {
  const clientSecretPath = process.argv[2];
  if (!clientSecretPath) {
    console.error(
      "Usage: npm run oauth-helper -- <path-to-client_secret.json>\n\n" +
        "Use a client_secret file of type 'installed' (with redirect_uris: ['http://localhost']).\n" +
        'If you only have "web" clients, that works too as long as the OAuth client allows localhost callbacks.'
    );
    process.exit(2);
  }
  const raw = JSON.parse(
    readFileSync(clientSecretPath, "utf8")
  ) as ClientSecretFile;
  const client = raw.installed ?? raw.web;
  if (!client) {
    console.error(
      `${clientSecretPath} has neither 'installed' nor 'web' key — not a valid client_secret JSON.`
    );
    process.exit(2);
  }
  if (!client.client_id || !client.client_secret) {
    console.error("client_secret file is missing client_id or client_secret.");
    process.exit(2);
  }

  const server = createServer();
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve())
  );
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  if (!port) {
    console.error("Failed to bind local port for OAuth callback.");
    process.exit(1);
  }
  const redirectUri = `http://localhost:${port}/callback`;

  const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authUrl.searchParams.set("client_id", client.client_id);
  authUrl.searchParams.set("redirect_uri", redirectUri);
  authUrl.searchParams.set("response_type", "code");
  authUrl.searchParams.set("scope", SCOPE);
  authUrl.searchParams.set("access_type", "offline");
  authUrl.searchParams.set("prompt", "consent");

  console.error("→ Opening browser for Google authorization…");
  console.error(`  If it doesn't open, visit:\n  ${authUrl.toString()}\n`);

  const platform = process.platform;
  const openCmd =
    platform === "win32"
      ? `start "" "${authUrl.toString()}"`
      : platform === "darwin"
        ? `open "${authUrl.toString()}"`
        : `xdg-open "${authUrl.toString()}"`;
  exec(openCmd, (err) => {
    if (err) {
      // not fatal; user can paste URL manually
    }
  });

  const code = await new Promise<string>((resolve, reject) => {
    server.on("request", (req, res) => {
      try {
        const u = new URL(req.url ?? "/", `http://localhost:${port}`);
        const c = u.searchParams.get("code");
        const e = u.searchParams.get("error");
        if (e) {
          res.statusCode = 400;
          res.end(`OAuth error: ${e}`);
          reject(new Error(`OAuth error: ${e}`));
          return;
        }
        if (c) {
          res.statusCode = 200;
          res.setHeader("Content-Type", "text/html; charset=utf-8");
          res.end(
            "<h2>OAuth complete.</h2><p>You can close this tab and return to the terminal.</p>"
          );
          resolve(c);
          return;
        }
        res.statusCode = 200;
        res.end("Waiting for OAuth callback…");
      } catch (err) {
        reject(err);
      }
    });
  });

  server.close();

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: client.client_id,
      client_secret: client.client_secret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }).toString(),
  });
  if (!tokenRes.ok) {
    console.error("Token exchange failed:", await tokenRes.text());
    process.exit(1);
  }
  const tokens = (await tokenRes.json()) as {
    refresh_token?: string;
    access_token?: string;
  };
  if (!tokens.refresh_token) {
    console.error(
      "No refresh_token returned. This usually means you've already authorized this client. " +
        "Revoke at https://myaccount.google.com/permissions, then re-run."
    );
    console.error("Response:", tokens);
    process.exit(1);
  }

  console.error(
    "\n✓ Refresh token minted. Add these fields to your creds file:\n"
  );
  console.log(
    JSON.stringify(
      {
        google_ads_client_id: client.client_id,
        google_ads_client_secret: client.client_secret,
        google_ads_refresh_token: tokens.refresh_token,
      },
      null,
      2
    )
  );
  console.error(
    "\nStill missing (get these separately): google_ads_developer_token (from ads.google.com → Tools → API Center), " +
      "google_ads_customer_id (top-right when logged into Google Ads)."
  );
}

main().catch((err) => {
  console.error("OAuth helper error:", err instanceof Error ? err.message : err);
  process.exit(1);
});
