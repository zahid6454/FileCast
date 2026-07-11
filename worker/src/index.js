// FileCast Worker entry point: itty-router dispatch, CORS, and the scheduled()
// cron handler for the daily purge.

import { Router } from "itty-router";
import { json, error, withCors, corsHeaders } from "./utils/http.js";

import { startGoogle, googleCallback, me, logout } from "./auth.js";
import { listTools, updateTool, reorderTools } from "./tools.js";
import { recordConversion } from "./conversions.js";
import { submitRating, getRating, getAllRatings } from "./ratings.js";
import { logError } from "./errors.js";
import {
  activeAnnouncement,
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
} from "./announcements.js";
import { dashboard, conversionStats, errorStats } from "./stats.js";
import { listUsers, getUser, exportMe, deleteMe } from "./users.js";
import { addFavorite, removeFavorite, listFavorites } from "./favorites.js";
import { updatePreferences } from "./preferences.js";
import { getHistory } from "./history.js";
import { triggerDeploy, deployStatus } from "./deploy.js";
import { handleScheduled } from "./scheduled.js";

const router = Router();

// --- Health ----------------------------------------------------------------
router.get("/", () => json({ service: "filecast-worker", ok: true }));
router.get("/api/health", () => json({ ok: true, ts: new Date().toISOString() }));

// --- Auth ------------------------------------------------------------------
router.get("/api/auth/google", startGoogle);
router.get("/api/auth/google/callback", googleCallback);
router.get("/api/auth/me", me);
router.post("/api/auth/logout", logout);

// --- Tools -----------------------------------------------------------------
router.get("/api/tools", listTools);
router.put("/api/tools/reorder", reorderTools); // must precede /:id
router.put("/api/tools/:id", updateTool);

// --- Conversions (dual-write) ---------------------------------------------
router.post("/api/conversions", recordConversion);

// --- Ratings ---------------------------------------------------------------
router.post("/api/ratings", submitRating);
router.get("/api/ratings", getAllRatings); // all-tools (build key/admin)
router.get("/api/ratings/:tool_id", getRating);

// --- Errors ----------------------------------------------------------------
router.post("/api/errors", logError);

// --- Announcements ---------------------------------------------------------
router.get("/api/announcements/active", activeAnnouncement);
router.get("/api/announcements", listAnnouncements);
router.post("/api/announcements", createAnnouncement);
router.put("/api/announcements/:id", updateAnnouncement);
router.delete("/api/announcements/:id", deleteAnnouncement);

// --- Stats -----------------------------------------------------------------
router.get("/api/stats/dashboard", dashboard);
router.get("/api/stats/conversions", conversionStats);
router.get("/api/stats/errors", errorStats);

// --- Users -----------------------------------------------------------------
router.get("/api/users/me/export", exportMe); // must precede /:id
router.delete("/api/users/me", deleteMe);
router.get("/api/users", listUsers);
router.get("/api/users/:id", getUser);

// --- Favorites -------------------------------------------------------------
router.post("/api/favorites", addFavorite);
router.delete("/api/favorites/:tool_id", removeFavorite);
router.get("/api/favorites", listFavorites);

// --- Preferences / history -------------------------------------------------
router.put("/api/preferences", updatePreferences);
router.get("/api/user/history", getHistory);

// --- Admin deploy ----------------------------------------------------------
router.post("/api/admin/deploy", triggerDeploy);
router.get("/api/admin/deploy/:run_id", deployStatus);

// 404
router.all("*", () => error(404, "Not found"));

export default {
  async fetch(request, env, ctx) {
    // CORS preflight — answer directly with the computed headers.
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(request, env) });
    }
    let response;
    try {
      response = await router.fetch(request, env, ctx);
    } catch (err) {
      console.error("unhandled", err && err.stack ? err.stack : String(err));
      response = error(500, "Internal server error");
    }
    return withCors(response, request, env);
  },

  // Cron Trigger → daily purge.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(event, env, ctx));
  },
};
