import { ConvexHttpClient } from "convex/browser";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

// Load environment variables
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

const convexUrl = process.env.CONVEX_SELF_HOSTED_URL || "http://127.0.0.1:3210";
const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY;

if (!adminKey) {
  console.error("Error: CONVEX_SELF_HOSTED_ADMIN_KEY environment variable is not set");
  process.exit(1);
}

async function listTables() {
  try {
    console.log(`Connecting to Convex at: ${convexUrl}`);
    
    const response = await fetch(`${convexUrl}/api/admin/tables`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${adminKey}`,
      },
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to list tables: ${error}`);
    }
    
    const tables = await response.json();
    console.log("Available tables:", tables);
    
  } catch (error) {
    console.error("Error listing tables:", error);
  }
}

listTables();
