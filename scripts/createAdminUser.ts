import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
// We'll use the Convex client to call the mutation

// Get the current module's directory
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load environment variables from .env.local
dotenv.config({ path: path.resolve(__dirname, "../../.env.local") });

// Get the admin key from environment variables
const adminKey = process.env.CONVEX_SELF_HOSTED_ADMIN_KEY;
if (!adminKey) {
  console.error("Error: CONVEX_SELF_HOSTED_ADMIN_KEY environment variable is not set");
  process.exit(1);
}

// Create a Convex client
const convexUrl = process.env.CONVEX_SELF_HOSTED_URL || "http://127.0.0.1:3210";
const client = new ConvexHttpClient(convexUrl);

// The admin key will be sent in the Authorization header

// Admin user details
const adminUser = {
  email: "nicholas.lawson@nhs.net",
  name: "Nicholas Lawson",
  isAdmin: true,
};

// Create the admin user
async function createAdmin() {
  try {
    console.log(`Connecting to Convex at: ${convexUrl}`);
    console.log(`Creating admin user: ${adminUser.email}`);
    
    // Generate a temporary password
    const tempPassword = Math.random().toString(36).slice(-12);
    
    console.log(`Using temporary password: ${tempPassword}`);
    
    // Try to create the user using the HTTP API directly
    const response = await fetch(`${convexUrl}/api/admin/createAdminUser`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${adminKey}`,
      },
      body: JSON.stringify({
        email: adminUser.email,
        name: adminUser.name,
        password: tempPassword,
      }),
    });
    
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create admin user: ${error}`);
    }
    
    const result = await response.json();
    
    console.log("Admin user created successfully:", result);
    console.log(`Email: ${adminUser.email}`);
    console.log("Please set up authentication through the Convex dashboard.");
  } catch (error) {
    console.error("Error creating admin user:", error instanceof Error ? error.message : String(error));
    
    // Try to get more detailed error information
    try {
      // Check if the admin API is available
      const response = await fetch(`${convexUrl}/api/version`);
      console.log(`Convex version: ${await response.text()}`);
      
      // Try to list existing users
      const usersResponse = await fetch(`${convexUrl}/api/admin/users`, {
        headers: {
          "Authorization": `Bearer ${adminKey}`,
        },
      });
      console.log(`List users status: ${usersResponse.status}`);
      if (!usersResponse.ok) {
        console.error(`Error listing users: ${await usersResponse.text()}`);
      } else {
        console.log(`Existing users: ${JSON.stringify(await usersResponse.json(), null, 2)}`);
      }
    } catch (e) {
      console.error("Error getting additional debug info:", e);
    }
  }
}

// Run the script
createAdmin();
