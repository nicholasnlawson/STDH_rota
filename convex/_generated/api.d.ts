/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";
import type * as auth from "../auth.js";
import type * as cleanup from "../cleanup.js";
import type * as clinics from "../clinics.js";
import type * as cron from "../cron.js";
import type * as dispensary from "../dispensary.js";
import type * as http from "../http.js";
import type * as migratePharmacists from "../migratePharmacists.js";
import type * as pharmacists from "../pharmacists.js";
import type * as requirements from "../requirements.js";
import type * as rotas from "../rotas.js";
import type * as scheduledTasks from "../scheduledTasks.js";

/**
 * A utility for referencing Convex functions in your app's API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
declare const fullApi: ApiFromModules<{
  auth: typeof auth;
  cleanup: typeof cleanup;
  clinics: typeof clinics;
  cron: typeof cron;
  dispensary: typeof dispensary;
  http: typeof http;
  migratePharmacists: typeof migratePharmacists;
  pharmacists: typeof pharmacists;
  requirements: typeof requirements;
  rotas: typeof rotas;
  scheduledTasks: typeof scheduledTasks;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
