/**
 * This script runs `npx @convex-dev/auth` to help with setting up
 * environment variables for Convex Auth.
 *
 * Modified to support self-hosted Convex instances.
 */

import fs from "fs";
import { config as loadEnvFile } from "dotenv";
import { spawnSync } from "child_process";

if (!fs.existsSync(".env.local")) {
  // Something is off, skip the script.
  process.exit(0);
}

const config = {};
loadEnvFile({ path: ".env.local", processEnv: config });

const runOnceWorkflow = process.argv.includes("--once");

if (runOnceWorkflow && config.SETUP_SCRIPT_RAN !== undefined) {
  // The script has already ran once, skip.
  process.exit(0);
}

// Check if we're using self-hosted Convex
if (config.CONVEX_SELF_HOSTED_URL) {
  console.log("✓ Self-hosted Convex configuration detected. Skipping cloud deployment check.");
  process.exit(0);
} else {
  // If not self-hosted, run the normal auth setup
  const result = spawnSync("npx", ["@convex-dev/auth", "--skip-git-check"], {
    stdio: "inherit",
  });

  if (runOnceWorkflow) {
    fs.writeFileSync(".env.local", `
SETUP_SCRIPT_RAN=1
`, { flag: "a" });
  }

  process.exit(result.status);
}