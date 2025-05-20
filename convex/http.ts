import { httpRouter } from "convex/server";

// Create a basic HTTP router
const http = httpRouter();

// Add your HTTP endpoints here
// Example:
// http.route({
//   path: "/my-endpoint",
//   method: "GET",
//   handler: async (request) => {
//     // Your handler code here
//     return new Response(null, { status: 200 });
//   },
// });

export default http;
