#!/usr/bin/env node
import { createServer } from "node:http";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { dataDir } from "./store.js";
import { handle } from "./server.js";
import { handleApi, readBody, sendError, sendJson, serveStatic } from "./http-routes.js";

const port = Number(process.env.MCP_SSE_PORT || process.env.PORT || 3100);
const host = process.env.MCP_SSE_HOST || "0.0.0.0";
const authToken = process.env.MCP_AUTH_TOKEN || "";
const corsOrigin = process.env.MCP_CORS_ORIGIN || "*";
const maxBodyBytes = Number(process.env.MCP_MAX_BODY_BYTES || process.env.READING_IMPORT_MAX_BYTES || 25_000_000);
const sessions = new Map();

function sendSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
}

function setCors(res) {
  res.setHeader("access-control-allow-origin", corsOrigin);
  res.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
  res.setHeader("access-control-allow-headers", "content-type, authorization");
}

function authorized(req, url) {
  if (!authToken) return true;
  if (req.headers.authorization === `Bearer ${authToken}`) return true;
  return url.searchParams.get("token") === authToken;
}

function endpointFor(req, sessionId) {
  const forwardedProto = req.headers["x-forwarded-proto"];
  const protocol = Array.isArray(forwardedProto) ? forwardedProto[0] : forwardedProto || "http";
  const hostHeader = req.headers["x-forwarded-host"] || req.headers.host || `${host}:${port}`;
  return `${protocol}://${hostHeader}/messages?sessionId=${encodeURIComponent(sessionId)}`;
}

function rpcError(id, code, message) {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

async function route(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || "/", `http://${req.headers.host || `${host}:${port}`}`);
  const protectedRoute =
    url.pathname.startsWith("/api/") ||
    url.pathname === "/mcp" ||
    url.pathname === "/sse" ||
    url.pathname === "/messages" ||
    url.pathname === "/health";

  if (protectedRoute && !authorized(req, url)) {
    sendJson(res, 401, { error: "Unauthorized" });
    return;
  }

  if (url.pathname.startsWith("/api/")) {
    return handleApi(req, res, url, { maxBodyBytes });
  }

  if (req.method === "POST" && url.pathname === "/mcp") {
    let message;
    try {
      message = await readBody(req, { maxBytes: maxBodyBytes, allowEmpty: false });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Invalid JSON body" });
      return;
    }

    try {
      const response = await handle(message);
      sendJson(res, 200, response || { accepted: true });
    } catch (error) {
      sendJson(res, 200, rpcError(message?.id ?? null, -32000, error.message || String(error)));
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/sse") {
    const sessionId = crypto.randomUUID();

    res.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    });
    res.write(": connected\n\n");

    sessions.set(sessionId, { res });
    sendSse(res, "endpoint", endpointFor(req, sessionId));

    const keepAlive = setInterval(() => {
      if (sessions.has(sessionId)) res.write(": ping\n\n");
    }, 30_000);

    req.on("close", () => {
      clearInterval(keepAlive);
      sessions.delete(sessionId);
    });
    return;
  }

  if (req.method === "POST" && url.pathname === "/messages") {
    const sessionId = url.searchParams.get("sessionId") || "";
    const session = sessions.get(sessionId);
    if (!session) {
      sendJson(res, 404, { error: "Unknown or expired SSE session" });
      return;
    }

    let message;
    try {
      message = await readBody(req, { maxBytes: maxBodyBytes, allowEmpty: false });
    } catch (error) {
      sendJson(res, 400, { error: error.message || "Invalid JSON body" });
      return;
    }

    sendJson(res, 202, { accepted: true });

    try {
      const response = await handle(message);
      if (response && sessions.has(sessionId)) sendSse(session.res, "message", response);
    } catch (error) {
      const response = rpcError(message?.id ?? null, -32000, error.message || String(error));
      if (sessions.has(sessionId)) sendSse(session.res, "message", response);
    }
    return;
  }

  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/health")) {
    if (url.pathname === "/") return serveStatic(req, res, url);
    sendJson(res, 200, {
      status: "ok",
      transport: "sse+http",
      dataDir,
      sessions: sessions.size,
      auth: authToken ? "enabled" : "disabled",
      endpoints: {
        reader: "/",
        api: "/api/*",
        sse: "/sse",
        messages: "/messages?sessionId=<id>",
        mcp: "/mcp",
      },
    });
    return;
  }

  if (req.method === "GET") {
    return serveStatic(req, res, url);
  }

  sendError(res, 404, "Not found");
}

export function startSseServer() {
  const server = createServer((req, res) => {
    route(req, res).catch((error) => {
      sendJson(res, 500, { error: error.message || String(error) });
    });
  });

  server.listen(port, host, () => {
    process.stderr.write(
      `Co-Reading remote server: http://${host}:${port}\nReader: /\nREST API: /api/*\nMCP SSE: /sse\nMCP POST: /mcp\nData dir: ${dataDir}\nAuth: ${
        authToken ? "enabled" : "disabled; set MCP_AUTH_TOKEN before exposing this server"
      }\n`,
    );
  });

  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  startSseServer();
}
