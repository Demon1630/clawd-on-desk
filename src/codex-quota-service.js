"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_TIMEOUT_MS = 12000;

function findCodexExeInTree(rootDir) {
  if (!rootDir || !fs.existsSync(rootDir)) return null;
  const stack = [rootDir];

  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isFile() && entry.name.toLowerCase() === "codex.exe") return fullPath;
      if (entry.isDirectory()) stack.push(fullPath);
    }
  }

  return null;
}

function resolveCodexPath() {
  const localAppData = process.env.LOCALAPPDATA || "";
  const candidates = [
    process.env.CODEX_CLI_PATH,
    path.join(localAppData, "OpenAI", "Codex", "bin", "codex.exe"),
  ].filter(Boolean);

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const nestedCodexExe = findCodexExeInTree(path.join(localAppData, "OpenAI", "Codex", "bin"));
  if (nestedCodexExe) return nestedCodexExe;

  return "codex";
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

function normalizeWindow(window) {
  if (!window) return null;
  const usedPercent = clampPercent(Number(window.usedPercent || 0));
  return {
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    windowDurationMins: window.windowDurationMins ?? null,
    resetsAt: window.resetsAt ? new Date(window.resetsAt * 1000).toISOString() : null,
  };
}

function firstSnapshot(map) {
  if (!map || typeof map !== "object") return null;
  const firstKey = Object.keys(map)[0];
  return firstKey ? map[firstKey] : null;
}

function normalizeSnapshot(snapshot) {
  const primary = normalizeWindow(snapshot.primary);
  const secondary = normalizeWindow(snapshot.secondary);
  const activeWindow = primary || secondary;
  return {
    status: "ok",
    limitId: snapshot.limitId || "codex",
    limitName: snapshot.limitName || "Codex",
    planType: snapshot.planType || "unknown",
    reachedType: snapshot.rateLimitReachedType || null,
    credits: snapshot.credits || null,
    primary,
    secondary,
    remainingPercent: activeWindow ? activeWindow.remainingPercent : null,
    usedPercent: activeWindow ? activeWindow.usedPercent : null,
    resetsAt: activeWindow ? activeWindow.resetsAt : null,
    fetchedAt: new Date().toISOString(),
  };
}

function handleMessage(line, pending) {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(message, "id")) return;
  const request = pending.get(message.id);
  if (!request) return;
  clearTimeout(request.timer);
  pending.delete(message.id);
  if (message.error) {
    request.reject(new Error(message.error.message || JSON.stringify(message.error)));
  } else {
    request.resolve(message.result);
  }
}

function requestRateLimits() {
  const codexPath = resolveCodexPath();
  const child = spawn(codexPath, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });

  let buffer = "";
  let stderr = "";
  let nextId = 1;
  const pending = new Map();

  const cleanup = () => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
    }
    pending.clear();
    if (!child.killed) child.kill();
  };

  const send = (method, params) => {
    const id = nextId++;
    const payload = params === undefined ? { id, method } : { id, method, params };
    child.stdin.write(`${JSON.stringify(payload)}\n`);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(id);
        reject(new Error(`Codex request timed out: ${method}`));
      }, DEFAULT_TIMEOUT_MS);
      pending.set(id, { resolve, reject, timer });
    });
  };

  child.stdout.on("data", (chunk) => {
    buffer += chunk.toString("utf8");
    let newlineIndex;
    while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, newlineIndex).trim();
      buffer = buffer.slice(newlineIndex + 1);
      if (!line) continue;
      handleMessage(line, pending);
    }
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });

  return new Promise((resolve) => {
    child.once("error", (error) => {
      cleanup();
      resolve({ status: "error", message: stderr || error.message || String(error), fetchedAt: new Date().toISOString() });
    });

    child.once("exit", (code) => {
      if (pending.size > 0) {
        cleanup();
        resolve({ status: "error", message: stderr || `Codex app-server exited with code ${code}`, fetchedAt: new Date().toISOString() });
      }
    });

    (async () => {
      try {
        await send("initialize", {
          clientInfo: { name: "clawd-on-desk", title: "Clawd on Desk", version: "0.9.0" },
          capabilities: null,
        });
        const result = await send("account/rateLimits/read");
        const snapshot = result.rateLimitsByLimitId?.codex
          || result.rateLimits
          || firstSnapshot(result.rateLimitsByLimitId);
        if (!snapshot) {
          throw new Error("Codex did not return a rate-limit snapshot.");
        }
        cleanup();
        resolve(normalizeSnapshot(snapshot));
      } catch (error) {
        cleanup();
        resolve({ status: "error", message: stderr || error.message || String(error), fetchedAt: new Date().toISOString() });
      }
    })();
  });
}

async function getCodexQuotaStatus() {
  return requestRateLimits();
}

module.exports = {
  getCodexQuotaStatus,
  normalizeSnapshot,
};
