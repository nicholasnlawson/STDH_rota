import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Schedule the cleanup to run every day at 3 AM
crons.daily(
  "cleanup-old-draft-rotas",
  { hourUTC: 3, minuteUTC: 0 }, // 3 AM UTC (4 AM BST, 5 AM BST in summer)
  internal.cleanup.cleanUpOldDraftRotas,
  {}
);

export default crons;
