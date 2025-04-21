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
import type * as clinics from "../clinics.js";
import type * as dispensary from "../dispensary.js";
import type * as http from "../http.js";
import type * as pharmacists from "../pharmacists.js";
import type * as requirements from "../requirements.js";
import type * as rotas from "../rotas.js";

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
  clinics: typeof clinics;
  dispensary: typeof dispensary;
  http: typeof http;
  pharmacists: typeof pharmacists;
  requirements: typeof requirements;
  rotas: typeof rotas;
}>;
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;
