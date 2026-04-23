/**
 * FRONTEND_URL may be comma-separated (e.g. Vite + CRA ports).
 * Used by Express CORS and Socket.IO so both match the browser origin.
 */
export function getFrontendOrigins() {
  const raw =
    process.env.FRONTEND_URL ||
    "http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:3000";
  return [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))];
}
