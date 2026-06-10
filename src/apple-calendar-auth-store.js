"use strict";

const fsDefault = require("fs");
const pathDefault = require("path");

const STORE_FILE_NAME = "apple-calendar-auth.dat";

function maskAppleId(appleId) {
  const text = typeof appleId === "string" ? appleId.trim() : "";
  if (!text) return "";
  const at = text.indexOf("@");
  if (at <= 1) return "***";
  const left = text.slice(0, at);
  const domain = text.slice(at);
  const keep = Math.min(3, left.length);
  return `${left.slice(0, keep)}***${domain}`;
}

function createAppleCalendarAuthStore({
  filePath,
  fs = fsDefault,
  path: pathModule = pathDefault,
  safeStorage,
} = {}) {
  if (typeof filePath !== "string" || !filePath) {
    throw new TypeError("createAppleCalendarAuthStore: filePath is required");
  }
  if (!fs || typeof fs.readFileSync !== "function" || typeof fs.writeFileSync !== "function") {
    throw new TypeError("createAppleCalendarAuthStore: fs must implement readFileSync/writeFileSync");
  }
  if (!safeStorage || typeof safeStorage.encryptString !== "function" || typeof safeStorage.decryptString !== "function") {
    throw new TypeError("createAppleCalendarAuthStore: safeStorage is required");
  }

  function ensureEncryptionAvailable() {
    if (typeof safeStorage.isEncryptionAvailable === "function" && !safeStorage.isEncryptionAvailable()) {
      throw new Error("secure storage is not available on this system");
    }
  }

  function readRawText() {
    try {
      return String(fs.readFileSync(filePath, "utf8") || "");
    } catch {
      return "";
    }
  }

  function decode(text) {
    const raw = String(text || "").trim();
    if (!raw) return null;
    try {
      const encrypted = Buffer.from(raw, "base64");
      const decrypted = safeStorage.decryptString(encrypted);
      const parsed = JSON.parse(decrypted);
      if (!parsed || typeof parsed !== "object") return null;
      const appleId = typeof parsed.appleId === "string" ? parsed.appleId.trim() : "";
      const appPassword = typeof parsed.appPassword === "string" ? parsed.appPassword.trim() : "";
      if (!appleId || !appPassword) return null;
      return { appleId, appPassword };
    } catch {
      return null;
    }
  }

  function encode(value) {
    ensureEncryptionAvailable();
    const payload = JSON.stringify({
      appleId: String(value.appleId || "").trim(),
      appPassword: String(value.appPassword || "").trim(),
    });
    return safeStorage.encryptString(payload).toString("base64");
  }

  return {
    filePath,
    async getCredentials() {
      return decode(readRawText());
    },
    async hasCredentials() {
      return decode(readRawText()) !== null;
    },
    async writeCredentials(value) {
      const appleId = String(value && value.appleId || "").trim();
      const appPassword = String(value && value.appPassword || "").trim();
      if (!appleId) throw new Error("appleId is required");
      if (!appPassword) throw new Error("appPassword is required");
      const dir = pathModule.dirname(filePath);
      fs.mkdirSync(dir, { recursive: true });
      const suffix = `${process.pid}.${Date.now()}.${Math.random().toString(16).slice(2)}`;
      const tmpPath = pathModule.join(dir, `.apple-calendar-auth.${suffix}.tmp`);
      const encoded = encode({ appleId, appPassword });
      fs.writeFileSync(tmpPath, encoded, { encoding: "utf8" });
      fs.renameSync(tmpPath, filePath);
    },
    async deleteCredentials() {
      try {
        fs.unlinkSync(filePath);
      } catch {}
    },
    async getMaskedAppleId() {
      const creds = decode(readRawText());
      return creds ? maskAppleId(creds.appleId) : "";
    },
    async getStoreStatus() {
      const creds = decode(readRawText());
      return {
        configured: !!creds,
        maskedAppleId: creds ? maskAppleId(creds.appleId) : "",
      };
    },
  };
}

module.exports = {
  createAppleCalendarAuthStore,
  maskAppleId,
  STORE_FILE_NAME,
};
