"use strict";

const crypto = require("crypto");
const { parseDocument } = require("htmlparser2");

const APPLE_CALDAV_BASE_URL = "https://caldav.icloud.com/";
const DEFAULT_SYNC_INTERVAL_MINUTES = 15;
const DEFAULT_SYNC_WINDOW_DAYS = 7;
const DEFAULT_EVENT_DURATION_MINUTES = 30;
const APP_SOURCE = "apple-calendar";
const DELETION_TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60_000;
const DAV_PROP_NAMESPACE_BY_NAME = {
  "current-user-principal": "d",
  principal: "d",
  href: "d",
  displayname: "d",
  resourcetype: "d",
  "current-user-privilege-set": "d",
  "sync-token": "d",
  "calendar-home-set": "cal",
  "calendar-data": "cal",
  "calendar-color": "ical",
  getctag: "cs",
  getetag: "d",
};

function createAppleCalendarSyncRuntime(options = {}) {
  const settingsController = options.settingsController;
  const authStore = options.authStore;
  const log = typeof options.log === "function" ? options.log : () => {};
  const now = typeof options.now === "function" ? options.now : Date.now;
  const fetchImpl = typeof options.fetch === "function" ? options.fetch : (typeof fetch === "function" ? fetch.bind(globalThis) : null);

  if (!settingsController) {
    throw new Error("createAppleCalendarSyncRuntime requires settingsController");
  }
  if (!authStore) {
    throw new Error("createAppleCalendarSyncRuntime requires authStore");
  }
  if (!fetchImpl) {
    throw new Error("createAppleCalendarSyncRuntime requires fetch");
  }

  let started = false;
  let timer = null;
  let timerDueAt = 0;
  let unsubscribe = [];
  let inFlight = null;
  let rerunRequested = false;
  let suppressChangeDrivenSync = 0;
  let cachedStatus = {
    configured: false,
    authorized: false,
    calendars: [],
    targetCalendarId: "",
    targetCalendarName: "",
    lastSyncAt: 0,
    lastSyncError: "",
  };

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
    timerDueAt = 0;
  }

  function schedule(delayMs) {
    if (!started) return;
    const delay = Math.max(0, Number(delayMs) || 0);
    const targetAt = now() + delay;
    if (timer && timerDueAt <= targetAt) return;
    clearTimer();
    timerDueAt = targetAt;
    timer = setTimeout(() => {
      timer = null;
      timerDueAt = 0;
      void executeSync({ reason: "timer" });
    }, delay);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function scheduleSoon() {
    schedule(1500);
  }

  function getSnapshot() {
    return settingsController.getSnapshot();
  }

  function getCreds() {
    return authStore.getCredentials();
  }

  function getSourceFingerprint(item) {
    return [
      String(item.title || ""),
      Number(item.dueAt) || 0,
      String(item.note || ""),
      item.done === true ? "1" : "0",
    ].join("\u001f");
  }

  function buildReminderIdFromUid(uid) {
    return `apple-${crypto.createHash("sha1").update(String(uid || "")).digest("hex").slice(0, 16)}`;
  }

  function buildCalendarUid(reminder) {
    const base = reminder && reminder.id ? reminder.id : `${now()}`;
    return `clawd-${crypto.createHash("sha1").update(String(base)).digest("hex").slice(0, 20)}@clawd.on.desk`;
  }

  function buildRemoteLookupKey(calendarId, uid) {
    return `${String(calendarId || "")}\u001f${String(uid || "")}`;
  }

  function isInSyncWindow(ts, windowStartAt, windowEndAt) {
    const value = Number(ts);
    return Number.isFinite(value) && value >= windowStartAt && value <= windowEndAt;
  }

  function formatIcsDateTimeUtc(ts) {
    const d = new Date(Number(ts));
    const pad = (n) => String(n).padStart(2, "0");
    return [
      d.getUTCFullYear(),
      pad(d.getUTCMonth() + 1),
      pad(d.getUTCDate()),
      "T",
      pad(d.getUTCHours()),
      pad(d.getUTCMinutes()),
      pad(d.getUTCSeconds()),
      "Z",
    ].join("");
  }

  function escapeIcsText(value) {
    return String(value == null ? "" : value)
      .replace(/\\/g, "\\\\")
      .replace(/\r\n|\r|\n/g, "\\n")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,");
  }

  function unfoldIcs(text) {
    const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const out = [];
    for (const line of lines) {
      if (!line) {
        out.push("");
        continue;
      }
      const trimmedStart = line.trimStart();
      const looksLikeStructuredIcsLine = /^(BEGIN|END|[A-Z0-9-]+(?:;|:))/.test(trimmedStart);
      if ((line[0] === " " || line[0] === "\t") && out.length > 0 && !looksLikeStructuredIcsLine) {
        out[out.length - 1] += trimmedStart;
      } else {
        out.push(looksLikeStructuredIcsLine ? trimmedStart : line);
      }
    }
    return out;
  }

  function unescapeIcsText(value) {
    return String(value == null ? "" : value)
      .replace(/\\n/gi, "\n")
      .replace(/\\,/g, ",")
      .replace(/\\;/g, ";")
      .replace(/\\\\/g, "\\");
  }

  function parseIcsDate(value, params = {}) {
    const text = String(value || "").trim();
    if (!text) return null;
    if (/^\d{8}$/.test(text)) {
      const y = Number(text.slice(0, 4));
      const m = Number(text.slice(4, 6)) - 1;
      const d = Number(text.slice(6, 8));
      const local = new Date(y, m, d, 0, 0, 0, 0);
      return Number.isFinite(local.getTime()) ? local.getTime() : null;
    }
    if (text.endsWith("Z")) {
      const utcMatch = text.match(/^(\d{8})T(\d{6})Z$/);
      if (!utcMatch) return null;
      const y = Number(text.slice(0, 4));
      const m = Number(text.slice(4, 6)) - 1;
      const d = Number(text.slice(6, 8));
      const hh = Number(text.slice(9, 11));
      const mm = Number(text.slice(11, 13));
      const ss = Number(text.slice(13, 15));
      const utc = Date.UTC(y, m, d, hh, mm, ss, 0);
      return Number.isFinite(utc) ? utc : null;
    }
    const match = text.match(/^(\d{8})T(\d{6})$/);
    if (!match) return null;
    const y = Number(text.slice(0, 4));
    const m = Number(text.slice(4, 6)) - 1;
    const d = Number(text.slice(6, 8));
    const hh = Number(text.slice(9, 11));
    const mm = Number(text.slice(11, 13));
    const ss = Number(text.slice(13, 15));
    const local = new Date(y, m, d, hh, mm, ss, 0);
    return Number.isFinite(local.getTime()) ? local.getTime() : null;
  }

  function foldIcsLine(line) {
    const text = String(line || "");
    if (text.length <= 74) return text;
    const parts = [];
    let start = 0;
    while (start < text.length) {
      const chunk = text.slice(start, start + (parts.length === 0 ? 75 : 74));
      parts.push(parts.length === 0 ? chunk : ` ${chunk}`);
      start += parts.length === 1 ? 75 : 74;
    }
    return parts.join("\r\n");
  }

  function buildEventIcs(event) {
    const uid = String(event.uid || buildCalendarUid(event.reminder));
    const summary = escapeIcsText(event.summary || "");
    const description = escapeIcsText(event.description || "");
    const location = escapeIcsText(event.location || "");
    const dtstart = formatIcsDateTimeUtc(event.startAt);
    const dtend = formatIcsDateTimeUtc(event.endAt || (Number(event.startAt) + DEFAULT_EVENT_DURATION_MINUTES * 60_000));
    const modifiedAt = formatIcsDateTimeUtc(event.modifiedAt || now());
    const lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//Clawd On Desk//Apple Calendar Sync//EN",
      "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT",
      `UID:${uid}`,
      `DTSTAMP:${modifiedAt}`,
      `LAST-MODIFIED:${modifiedAt}`,
      `SEQUENCE:${Number.isInteger(event.sequence) && event.sequence >= 0 ? event.sequence : 0}`,
      `SUMMARY:${summary}`,
      `DTSTART:${dtstart}`,
      `DTEND:${dtend}`,
      `DESCRIPTION:${description}`,
      `LOCATION:${location}`,
      `X-CLAWD-REMINDER-ID:${escapeIcsText(event.reminderId || "")}`,
      `X-CLAWD-SOURCE:${APP_SOURCE}`,
      `X-CLAWD-DONE:${event.done === true ? "1" : "0"}`,
      "END:VEVENT",
      "END:VCALENDAR",
      "",
    ];
    return lines.map(foldIcsLine).join("\r\n");
  }

  function parsePropertyNode(node) {
    const out = {};
    if (!node || !node.children) return out;
    for (const child of node.children) {
      if (!child || child.type !== "tag") continue;
      const name = localName(child.name);
      if (!name) continue;
      out[name] = child;
    }
    return out;
  }

  function localName(name) {
    return String(name || "").split(":").pop().toLowerCase();
  }

  function nodeText(node) {
    if (!node || !node.children) return "";
    let text = "";
    for (const child of node.children) {
      if (child.type === "text" || child.type === "cdata") text += child.data || "";
      else if (child.children) text += nodeText(child);
    }
    return text;
  }

  function findDescendants(node, targetName, out = []) {
    if (!node) return out;
    if (node.type === "tag" && localName(node.name) === targetName) out.push(node);
    if (!node.children) return out;
    for (const child of node.children) findDescendants(child, targetName, out);
    return out;
  }

  function findFirstDescendant(node, targetName) {
    const found = findDescendants(node, targetName, []);
    return found.length > 0 ? found[0] : null;
  }

  function hasDescendant(node, targetName) {
    return findFirstDescendant(node, targetName) !== null;
  }

  function parseMultistatus(xml) {
    const doc = parseDocument(String(xml || ""), { xmlMode: true, lowerCaseTags: false, recognizeSelfClosing: true });
    const responses = findDescendants(doc, "response", []);
    return responses.map((response) => {
      const propNodes = findDescendants(response, "prop", []);
      const propMap = {};
      for (const propNode of propNodes) Object.assign(propMap, parsePropertyNode(propNode));
      return {
        href: nodeText(findFirstDescendant(response, "href")).trim(),
        props: propMap,
        status: nodeText(findFirstDescendant(response, "status")).trim(),
      };
    });
  }

  function isCalendarCollection(response) {
    const resourcetype = response && response.props && response.props.resourcetype;
    return !!(resourcetype && hasDescendant(resourcetype, "calendar"));
  }

  function hasWritePrivilege(response) {
    const set = response && response.props && response.props["current-user-privilege-set"];
    return !!(set && (hasDescendant(set, "write") || hasDescendant(set, "all")));
  }

  function getPropText(response, key) {
    const node = response && response.props && response.props[key];
    return node ? nodeText(node).trim() : "";
  }

  function summarizeCalendarDataForLog(calendarData) {
    const text = String(calendarData || "");
    const upper = text.toUpperCase();
    const lines = unfoldIcs(text).slice(0, 12).map((line) => {
      const value = String(line || "");
      const idx = value.indexOf(":");
      if (idx <= 0) return value.slice(0, 48);
      return `${value.slice(0, idx)}:<redacted>`;
    });
    return {
      length: text.length,
      hasVcalendar: upper.includes("BEGIN:VCALENDAR"),
      hasVevent: upper.includes("BEGIN:VEVENT"),
      firstLines: lines,
    };
  }

  async function davRequest(url, { method, depth = 0, body = "", extraHeaders = {} } = {}, creds) {
    const credentials = creds || await getCreds();
    if (!credentials) {
      throw new Error("Apple Calendar credentials are not configured");
    }
    const auth = Buffer.from(`${credentials.appleId}:${credentials.appPassword}`).toString("base64");
    const headers = {
      Authorization: `Basic ${auth}`,
      Accept: "application/xml, text/xml, */*",
      ...extraHeaders,
    };
    if (method === "PROPFIND" || method === "REPORT") {
      headers.Depth = String(depth);
      if (!headers["Content-Type"]) headers["Content-Type"] = "application/xml; charset=utf-8";
    }
    const response = await fetchImpl(url, {
      method,
      headers,
      body: body || undefined,
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}: ${text.slice(0, 240)}`);
    }
    return { response, text };
  }

  async function propfind(url, depth, propNames, creds) {
    const props = propNames.map((name) => {
      const local = localName(name);
      const ns = DAV_PROP_NAMESPACE_BY_NAME[local] || "d";
      return `<${ns}:${local} />`;
    }).join("");
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<d:propfind
  xmlns:d="DAV:"
  xmlns:cal="urn:ietf:params:xml:ns:caldav"
  xmlns:cs="http://calendarserver.org/ns/"
  xmlns:ical="http://apple.com/ns/ical/">
  <d:prop>${props}</d:prop>
</d:propfind>`;
    const { text } = await davRequest(url, {
      method: "PROPFIND",
      depth,
      body,
    }, creds);
    return parseMultistatus(text);
  }

  async function report(url, body, creds) {
    const { text } = await davRequest(url, {
      method: "REPORT",
      depth: 1,
      body,
    }, creds);
    return parseMultistatus(text);
  }

  async function getCalendarObject(url, creds) {
    const { response, text } = await davRequest(url, {
      method: "GET",
      extraHeaders: {
        Accept: "text/calendar, */*",
      },
    }, creds);
    return {
      calendarData: text,
      etag: response.headers.get("etag") || "",
    };
  }

  async function discoverCalendars(creds) {
    const baseResponses = await propfind(APPLE_CALDAV_BASE_URL, 0, ["current-user-principal"], creds);
    const principalHref = baseResponses.length > 0
      ? getPropText(baseResponses[0], "current-user-principal") || getPropText(baseResponses[0], "principal")
      : "";
    if (!principalHref) {
      throw new Error("Could not discover Apple Calendar principal URL");
    }
    const principalUrl = new URL(principalHref, APPLE_CALDAV_BASE_URL).toString();
    const principalResponses = await propfind(principalUrl, 0, ["calendar-home-set"], creds);
    const homeHref = principalResponses.length > 0 ? getPropText(principalResponses[0], "calendar-home-set") : "";
    if (!homeHref) {
      throw new Error("Could not discover Apple Calendar home-set URL");
    }
    const homeUrl = new URL(homeHref, APPLE_CALDAV_BASE_URL).toString();
    const homeResponses = await propfind(homeUrl, 1, [
      "displayname",
      "resourcetype",
      "current-user-privilege-set",
      "calendar-color",
      "sync-token",
      "getctag",
    ], creds);

    const calendars = homeResponses
      .filter((response) => response.href && isCalendarCollection(response))
      .map((response) => {
        const href = new URL(response.href, homeUrl).toString();
        return {
          id: href,
          href,
          displayName: getPropText(response, "displayname") || href,
          color: getPropText(response, "calendar-color"),
          syncToken: getPropText(response, "sync-token"),
          ctag: getPropText(response, "getctag"),
          writable: hasWritePrivilege(response),
        };
      });

    log("discover-calendars", {
      principalUrl,
      homeUrl,
      totalCalendars: calendars.length,
      writableCalendars: calendars.filter((calendar) => calendar.writable).length,
      calendarNames: calendars.map((calendar) => calendar.displayName || calendar.id),
    });

    return { principalUrl, homeUrl, calendars };
  }

  async function fetchRemoteEvents(calendarHref, windowDays, creds) {
    const startAt = now() - 24 * 60 * 60_000;
    const endAt = now() + Math.max(1, Number(windowDays) || DEFAULT_SYNC_WINDOW_DAYS) * 24 * 60 * 60_000;
    const body = `<?xml version="1.0" encoding="UTF-8"?>
<c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">
  <d:prop>
    <d:getetag />
    <c:calendar-data />
  </d:prop>
  <c:filter>
    <c:comp-filter name="VCALENDAR">
      <c:comp-filter name="VEVENT">
        <c:time-range start="${new Date(startAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}" end="${new Date(endAt).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z")}" />
      </c:comp-filter>
    </c:comp-filter>
  </c:filter>
</c:calendar-query>`;
    const responses = await report(calendarHref, body, creds);
    const events = [];
    const responseSummaries = [];
    for (const response of responses) {
      let calendarData = getPropText(response, "calendar-data");
      let etag = getPropText(response, "getetag").replace(/^W\//, "").trim();
      if (!calendarData && response.href) {
        const objectUrl = new URL(response.href, calendarHref).toString();
        try {
          const object = await getCalendarObject(objectUrl, creds);
          calendarData = object.calendarData || "";
          etag = object.etag || etag;
        } catch (err) {
          log("fetch-calendar-object-failed", {
            href: response.href,
            message: err && err.message ? err.message : String(err),
          });
        }
      }
      responseSummaries.push({
        href: response.href || "",
        propKeys: response && response.props ? Object.keys(response.props) : [],
        calendarData: summarizeCalendarDataForLog(calendarData),
      });
      if (!calendarData) continue;
      const parsed = parseCalendarData(calendarData);
      for (const event of parsed) {
        event.href = response.href;
        event.etag = etag;
        events.push(event);
      }
    }
    log("fetch-remote-events", {
      calendarHref,
      windowDays,
      startAt,
      endAt,
      responseCount: responses.length,
      eventCount: events.length,
      responses: responseSummaries,
    });
    return events;
  }

  function parseCalendarData(calendarData) {
    const lines = unfoldIcs(calendarData);
    const events = [];
    let current = null;
    for (const rawLine of lines) {
      const line = String(rawLine || "").trimEnd();
      if (!line) continue;
      if (line === "BEGIN:VEVENT") {
        current = { props: {} };
        continue;
      }
      if (line === "END:VEVENT") {
        if (current) events.push(normalizeRemoteEvent(current));
        current = null;
        continue;
      }
      if (!current) continue;
      const sep = line.indexOf(":");
      if (sep <= 0) continue;
      const left = line.slice(0, sep);
      const value = line.slice(sep + 1);
      const parts = left.split(";");
      const name = localName(parts.shift());
      const params = {};
      for (const part of parts) {
        const idx = part.indexOf("=");
        if (idx > 0) params[part.slice(0, idx).toUpperCase()] = part.slice(idx + 1);
      }
      current.props[name] = { value, params };
    }
    return events.filter(Boolean);
  }

  function normalizeRemoteEvent(raw) {
    const props = raw && raw.props ? raw.props : {};
    const uid = props.uid && props.uid.value ? String(props.uid.value).trim() : "";
    if (!uid) return null;
    if (props.status && String(props.status.value || "").toUpperCase() === "CANCELLED") return null;
    const startAt = parseIcsDate(props.dtstart && props.dtstart.value, props.dtstart && props.dtstart.params);
    if (!Number.isFinite(startAt) || startAt <= 0) return null;
    const endAt = parseIcsDate(props.dtend && props.dtend.value, props.dtend && props.dtend.params);
    const modifiedAt = parseIcsDate(props["last-modified"] && props["last-modified"].value, props["last-modified"] && props["last-modified"].params) || now();
    const summary = unescapeIcsText(props.summary && props.summary.value ? props.summary.value : "");
    const description = unescapeIcsText(props.description && props.description.value ? props.description.value : "");
    const location = unescapeIcsText(props.location && props.location.value ? props.location.value : "");
    const done = String(props["x-clawd-done"] && props["x-clawd-done"].value ? props["x-clawd-done"].value : "").trim() === "1";
    const sourceReminderId = String(props["x-clawd-reminder-id"] && props["x-clawd-reminder-id"].value ? props["x-clawd-reminder-id"].value : "").trim();
    return {
      uid,
      startAt,
      endAt: Number.isFinite(endAt) && endAt > startAt ? endAt : startAt + DEFAULT_EVENT_DURATION_MINUTES * 60_000,
      modifiedAt,
      summary,
      description,
      location,
      done,
      sourceReminderId,
      raw: raw,
    };
  }

  function buildReminderFromRemote(remote, calendar, preferredReminderId = "") {
    const reminderId = String(remote.sourceReminderId || preferredReminderId || buildReminderIdFromUid(remote.uid)).trim();
    const noteParts = [];
    if (remote.location) noteParts.push(remote.location);
    if (remote.description) noteParts.push(remote.description);
    const note = noteParts.join("\n").trim();
    const result = {
      id: reminderId,
      title: remote.summary || "Untitled event",
      dueAt: remote.startAt,
      createdAt: remote.modifiedAt || remote.startAt,
      updatedAt: remote.modifiedAt || remote.startAt,
      done: remote.done === true,
      source: APP_SOURCE,
      sourceUid: remote.uid,
      sourceCalendarId: calendar.id,
      sourceCalendarName: calendar.displayName || "",
      sourceRemoteEtag: remote.etag || "",
      sourceRemoteHref: remote.href || "",
      sourceRemoteModifiedAt: remote.modifiedAt || remote.startAt,
      sourceFingerprint: "",
      lastSyncedAt: now(),
    };
    if (note) result.note = note;
    result.sourceFingerprint = getSourceFingerprint(result);
    return result;
  }

  function buildRemoteEventFromReminder(reminder, calendar) {
    return {
      uid: reminder.sourceUid || buildCalendarUid(reminder),
      reminderId: reminder.id,
      summary: reminder.title || "Reminder",
      description: String(reminder.note || "").trim(),
      location: "",
      startAt: Number(reminder.dueAt) || now(),
      endAt: Number(reminder.dueAt) ? Number(reminder.dueAt) + DEFAULT_EVENT_DURATION_MINUTES * 60_000 : now() + DEFAULT_EVENT_DURATION_MINUTES * 60_000,
      modifiedAt: now(),
      sequence: 0,
      done: reminder.done === true,
    };
  }

  function resolveReminderCalendar(reminder, calendarsById, fallbackCalendar) {
    if (reminder && reminder.sourceCalendarId && calendarsById.has(reminder.sourceCalendarId)) {
      return calendarsById.get(reminder.sourceCalendarId);
    }
    return fallbackCalendar;
  }

  async function putRemoteEvent(calendarHref, remoteEvent, creds) {
    const ics = buildEventIcs(remoteEvent);
    const eventUrl = new URL(`${encodeURIComponent(remoteEvent.uid)}.ics`, calendarHref.endsWith("/") ? calendarHref : `${calendarHref}/`).toString();
    const { response } = await davRequest(eventUrl, {
      method: "PUT",
      body: ics,
      extraHeaders: {
        "If-None-Match": "*",
        "Content-Type": "text/calendar; charset=utf-8",
      },
    }, creds);
    return {
      href: eventUrl,
      etag: response.headers.get("etag") || "",
    };
  }

  async function updateRemoteEvent(calendarHref, remoteEvent, creds) {
    const ics = buildEventIcs(remoteEvent);
    const eventUrl = new URL(`${encodeURIComponent(remoteEvent.uid)}.ics`, calendarHref.endsWith("/") ? calendarHref : `${calendarHref}/`).toString();
    const { response } = await davRequest(eventUrl, {
      method: "PUT",
      body: ics,
      extraHeaders: {
        "Content-Type": "text/calendar; charset=utf-8",
      },
    }, creds);
    return {
      href: eventUrl,
      etag: response.headers.get("etag") || "",
    };
  }

  async function deleteRemoteEvent(calendarHref, uid, creds) {
    const eventUrl = new URL(`${encodeURIComponent(uid)}.ics`, calendarHref.endsWith("/") ? calendarHref : `${calendarHref}/`).toString();
    await davRequest(eventUrl, { method: "DELETE", extraHeaders: {} }, creds);
  }

  async function deleteRemoteObject(remoteHref, calendarHref, uid, creds) {
    if (remoteHref) {
      const eventUrl = new URL(remoteHref, calendarHref || APPLE_CALDAV_BASE_URL).toString();
      await davRequest(eventUrl, { method: "DELETE", extraHeaders: {} }, creds);
      return;
    }
    await deleteRemoteEvent(calendarHref, uid, creds);
  }

  function commitSettings(partial) {
    if (!partial || typeof partial !== "object") return Promise.resolve({ status: "ok", noop: true });
    suppressChangeDrivenSync += 1;
    return Promise.resolve(settingsController.applyBulk(partial)).finally(() => {
      suppressChangeDrivenSync = Math.max(0, suppressChangeDrivenSync - 1);
    });
  }

  async function doSync(reason = "manual") {
    const snapshot = getSnapshot();
    const enabled = snapshot.appleCalendarSyncEnabled === true;
    if (!enabled && reason !== "manual" && reason !== "credentials") {
      cachedStatus = {
        ...cachedStatus,
        configured: !!(await authStore.getCredentials()),
        authorized: false,
        calendars: [],
        targetCalendarId: snapshot.appleCalendarTargetCalendarId || "",
        targetCalendarName: snapshot.appleCalendarTargetCalendarName || "",
      };
      return { status: "ok", skipped: true, reason: "disabled" };
    }

    const creds = await getCreds();
    if (!creds) {
      const partial = {
        appleCalendarLastSyncError: "Apple Calendar credentials are not configured",
      };
      await commitSettings(partial);
      cachedStatus = {
        ...cachedStatus,
        configured: false,
        authorized: false,
        calendars: [],
        lastSyncError: partial.appleCalendarLastSyncError,
      };
      return { status: "error", message: partial.appleCalendarLastSyncError };
    }

    const discovery = await discoverCalendars(creds);
    const writableCalendars = discovery.calendars.filter((calendar) => calendar.writable);
    const availableCalendars = writableCalendars.length > 0 ? writableCalendars : discovery.calendars;
    if (availableCalendars.length === 0) {
      throw new Error("No writable Apple calendars were found");
    }

    const syncAllCalendars = snapshot.appleCalendarSyncAllCalendars === true;
    let target = availableCalendars.find((calendar) => calendar.id === snapshot.appleCalendarTargetCalendarId);
    if (!target) {
      target = availableCalendars[0];
      await commitSettings({
        appleCalendarTargetCalendarId: target.id,
        appleCalendarTargetCalendarName: target.displayName || "",
      });
    }

    const syncCalendars = syncAllCalendars ? availableCalendars : [target];
    const calendarsById = new Map(syncCalendars.map((calendar) => [calendar.id, calendar]));
    const remoteEvents = [];
    const syncStartedAt = now();
    const windowStartAt = syncStartedAt - 24 * 60 * 60_000;
    const windowEndAt = syncStartedAt + Math.max(1, snapshot.appleCalendarSyncWindowDays || DEFAULT_SYNC_WINDOW_DAYS) * 24 * 60 * 60_000;
    const rawTombstones = snapshot.appleCalendarDeletionTombstones
      && typeof snapshot.appleCalendarDeletionTombstones === "object"
      && !Array.isArray(snapshot.appleCalendarDeletionTombstones)
      ? snapshot.appleCalendarDeletionTombstones
      : {};
    const nextTombstones = {};
    for (const [key, tombstone] of Object.entries(rawTombstones)) {
      const deletedAt = Number(tombstone && tombstone.deletedAt);
      if (Number.isFinite(deletedAt) && deletedAt > 0 && syncStartedAt - deletedAt <= DELETION_TOMBSTONE_TTL_MS) {
        nextTombstones[key] = tombstone;
      }
    }
    const remoteDeletes = [];
    log("sync-start", {
      reason,
      availableCalendars: availableCalendars.map((calendar) => ({
        id: calendar.id,
        name: calendar.displayName || "",
        writable: calendar.writable === true,
      })),
      syncedCalendars: syncCalendars.map((calendar) => ({
        id: calendar.id,
        name: calendar.displayName || "",
      })),
      syncAllCalendars,
      targetCalendarId: target.id,
      targetCalendarName: target.displayName || "",
      windowDays: snapshot.appleCalendarSyncWindowDays || DEFAULT_SYNC_WINDOW_DAYS,
      localReminderCount: snapshot.reminders && typeof snapshot.reminders === "object" ? Object.keys(snapshot.reminders).length : 0,
    });
    for (const calendar of syncCalendars) {
      const events = await fetchRemoteEvents(calendar.href, snapshot.appleCalendarSyncWindowDays || DEFAULT_SYNC_WINDOW_DAYS, creds);
      for (const event of events) {
        if (!event || !event.uid) continue;
        event.calendarId = calendar.id;
        event.calendarName = calendar.displayName || "";
        remoteEvents.push(event);
      }
    }
    const remoteByKey = new Map();
    for (const event of remoteEvents) {
      remoteByKey.set(buildRemoteLookupKey(event.calendarId, event.uid), event);
    }

    const current = snapshot.reminders && typeof snapshot.reminders === "object" ? snapshot.reminders : {};
    const nextReminders = { ...current };
    const localChanges = [];
    const remoteChanges = [];
    const addedRemote = [];
    const linkedRemoteKeys = new Set();

    for (const reminder of Object.values(current)) {
      if (!reminder || typeof reminder !== "object") continue;
      const currentFingerprint = getSourceFingerprint(reminder);
      const hasSource = reminder.source === APP_SOURCE && typeof reminder.sourceUid === "string" && reminder.sourceUid;
      if (!hasSource) {
        localChanges.push({ type: "push", reminder });
        continue;
      }
      if (!syncAllCalendars && reminder.sourceCalendarId && reminder.sourceCalendarId !== target.id) {
        continue;
      }
      const reminderRemoteKey = buildRemoteLookupKey(reminder.sourceCalendarId || target.id, reminder.sourceUid);
      linkedRemoteKeys.add(reminderRemoteKey);
      const remote = remoteByKey.get(reminderRemoteKey);
      if (!remote) {
        if (isInSyncWindow(reminder.dueAt, windowStartAt, windowEndAt)) {
          delete nextReminders[reminder.id];
          const key = buildRemoteLookupKey(reminder.sourceCalendarId || target.id, reminder.sourceUid);
          nextTombstones[key] = {
            uid: reminder.sourceUid,
            calendarId: reminder.sourceCalendarId || target.id,
            calendarHref: reminder.sourceCalendarId || target.id,
            remoteHref: reminder.sourceRemoteHref || "",
            reminderId: reminder.id,
            deletedAt: syncStartedAt,
          };
        }
        continue;
      }
      const remoteFingerprint = getSourceFingerprint(buildReminderFromRemote(remote, {
        id: remote.calendarId || reminder.sourceCalendarId || target.id,
        displayName: remote.calendarName || reminder.sourceCalendarName || target.displayName || "",
      }, reminder.id));
      const localEdited = currentFingerprint !== (reminder.sourceFingerprint || "");
      const remoteEdited = String(reminder.sourceRemoteEtag || "") !== String(remote.etag || "");
      if (localEdited && !remoteEdited) {
        localChanges.push({ type: "update-remote", reminder, remote });
      } else if (!localEdited && remoteEdited) {
        remoteChanges.push({ type: "pull", reminder, remote });
      } else if (localEdited && remoteEdited) {
        const localWins = Number(reminder.updatedAt || 0) >= Number(reminder.sourceRemoteModifiedAt || 0);
        if (localWins) localChanges.push({ type: "update-remote", reminder, remote });
        else remoteChanges.push({ type: "pull", reminder, remote });
      } else if (currentFingerprint !== remoteFingerprint) {
        remoteChanges.push({ type: "pull", reminder, remote });
      }
    }

    for (const action of localChanges) {
      const reminder = action.reminder;
      const destinationCalendar = action.type === "push"
        ? target
        : resolveReminderCalendar(reminder, calendarsById, target);
      const remote = buildRemoteEventFromReminder(reminder, destinationCalendar);
      const result = action.type === "push"
        ? await putRemoteEvent(destinationCalendar.href, remote, creds)
        : await updateRemoteEvent(destinationCalendar.href, remote, creds);
      const sourceUid = remote.uid;
      const next = {
        ...reminder,
        source: APP_SOURCE,
        sourceUid,
        sourceCalendarId: destinationCalendar.id,
        sourceCalendarName: destinationCalendar.displayName || "",
        sourceRemoteEtag: result.etag || reminder.sourceRemoteEtag || "",
        sourceRemoteHref: result.href || reminder.sourceRemoteHref || "",
        sourceRemoteModifiedAt: now(),
        lastSyncedAt: now(),
      };
      next.sourceFingerprint = getSourceFingerprint(next);
      nextReminders[reminder.id] = next;
      addedRemote.push(sourceUid);
    }

    for (const action of remoteChanges) {
      const remote = action.remote;
      const remoteCalendar = {
        id: remote.calendarId || action.reminder.sourceCalendarId || target.id,
        displayName: remote.calendarName || action.reminder.sourceCalendarName || target.displayName || "",
      };
      const next = {
        ...action.reminder,
        ...buildReminderFromRemote(remote, remoteCalendar, action.reminder && action.reminder.id),
        lastSyncedAt: now(),
      };
      next.sourceFingerprint = getSourceFingerprint(next);
      nextReminders[next.id] = next;
    }

    for (const remote of remoteEvents) {
      if (!remote || !remote.uid) continue;
      const remoteKey = buildRemoteLookupKey(remote.calendarId || target.id, remote.uid);
      if (linkedRemoteKeys.has(remoteKey)) continue;
      if (nextTombstones[remoteKey]) {
        const calendar = calendarsById.get(remote.calendarId) || target;
        remoteDeletes.push({
          calendar,
          uid: remote.uid,
          href: remote.href || nextTombstones[remoteKey].remoteHref || "",
        });
        continue;
      }
      const remoteCalendar = {
        id: remote.calendarId || target.id,
        displayName: remote.calendarName || target.displayName || "",
      };
      const preferredReminderId = remote.sourceReminderId && current[remote.sourceReminderId]
        ? remote.sourceReminderId
        : "";
      const imported = buildReminderFromRemote(remote, remoteCalendar, preferredReminderId);
      imported.sourceFingerprint = getSourceFingerprint(imported);
      imported.lastSyncedAt = now();
      if (preferredReminderId && current[preferredReminderId]) {
        nextReminders[preferredReminderId] = {
          ...current[preferredReminderId],
          ...imported,
        };
      } else {
        nextReminders[imported.id] = imported;
      }
    }

    for (const action of remoteDeletes) {
      await deleteRemoteObject(action.href, action.calendar && action.calendar.href, action.uid, creds);
    }

    log("sync-summary", {
      reason,
      remoteEventCount: remoteEvents.length,
      localPushCount: localChanges.filter((action) => action.type === "push").length,
      localUpdateRemoteCount: localChanges.filter((action) => action.type === "update-remote").length,
      remoteDeleteCount: remoteDeletes.length,
      remotePullCount: remoteChanges.length,
      importedRemoteOnlyCount: remoteEvents.filter((remote) => remote && remote.uid && !linkedRemoteKeys.has(buildRemoteLookupKey(remote.calendarId || target.id, remote.uid))).length,
      nextReminderCount: Object.keys(nextReminders).length,
    });

    const partial = {
      reminders: nextReminders,
      appleCalendarLastSyncAt: now(),
      appleCalendarLastSyncError: "",
      appleCalendarTargetCalendarId: target.id,
      appleCalendarTargetCalendarName: target.displayName || "",
      appleCalendarDeletionTombstones: nextTombstones,
    };
    await commitSettings(partial);

    cachedStatus = {
      configured: true,
      authorized: true,
      calendars: discovery.calendars,
      targetCalendarId: target.id,
      targetCalendarName: target.displayName || "",
      lastSyncAt: partial.appleCalendarLastSyncAt,
      lastSyncError: "",
    };
    return {
      status: "ok",
      targetCalendarId: target.id,
      targetCalendarName: target.displayName || "",
      calendars: discovery.calendars,
      addedRemoteCount: addedRemote.length,
      updatedCount: remoteChanges.length,
      deletedCount: 0,
    };
  }

  async function executeSync(options = {}) {
    if (inFlight) {
      rerunRequested = true;
      return inFlight;
    }
    const task = Promise.resolve()
      .then(() => doSync(options.reason || "manual"))
      .then(async (result) => {
        const snapshot = getSnapshot();
        cachedStatus = {
          ...cachedStatus,
          configured: true,
          authorized: true,
          targetCalendarId: snapshot.appleCalendarTargetCalendarId || cachedStatus.targetCalendarId,
          targetCalendarName: snapshot.appleCalendarTargetCalendarName || cachedStatus.targetCalendarName,
          lastSyncAt: snapshot.appleCalendarLastSyncAt || cachedStatus.lastSyncAt,
          lastSyncError: snapshot.appleCalendarLastSyncError || "",
        };
        return result;
      })
      .catch(async (err) => {
        const message = err && err.message ? err.message : String(err);
        log(`apple-calendar sync failed: ${message}`);
        await commitSettings({
          appleCalendarLastSyncError: message,
        });
        cachedStatus = {
          ...cachedStatus,
          lastSyncError: message,
        };
        return { status: "error", message };
      })
      .finally(() => {
        inFlight = null;
        const snapshot = getSnapshot();
        if (snapshot.appleCalendarSyncEnabled === true) {
          const interval = Number.isInteger(snapshot.appleCalendarSyncIntervalMinutes)
            ? snapshot.appleCalendarSyncIntervalMinutes
            : DEFAULT_SYNC_INTERVAL_MINUTES;
          schedule(interval * 60_000);
        }
        if (rerunRequested) {
          rerunRequested = false;
          scheduleSoon();
        }
      });
    inFlight = task;
    return task;
  }

  function subscribe() {
    unsubscribe.push(settingsController.subscribeKey("appleCalendarSyncEnabled", () => {
      if (suppressChangeDrivenSync > 0) return;
      const enabled = settingsController.get("appleCalendarSyncEnabled") === true;
      if (enabled) scheduleSoon();
      else clearTimer();
    }));
    unsubscribe.push(settingsController.subscribeKey("appleCalendarSyncIntervalMinutes", () => {
      if (suppressChangeDrivenSync > 0) return;
      if (settingsController.get("appleCalendarSyncEnabled") === true) scheduleSoon();
    }));
    unsubscribe.push(settingsController.subscribeKey("appleCalendarSyncWindowDays", () => {
      if (suppressChangeDrivenSync > 0) return;
      if (settingsController.get("appleCalendarSyncEnabled") === true) scheduleSoon();
    }));
    unsubscribe.push(settingsController.subscribeKey("appleCalendarTargetCalendarId", () => {
      if (suppressChangeDrivenSync > 0) return;
      if (settingsController.get("appleCalendarSyncEnabled") === true) scheduleSoon();
    }));
    unsubscribe.push(settingsController.subscribeKey("appleCalendarSyncAllCalendars", () => {
      if (suppressChangeDrivenSync > 0) return;
      if (settingsController.get("appleCalendarSyncEnabled") === true) scheduleSoon();
    }));
    unsubscribe.push(settingsController.subscribeKey("reminders", () => {
      if (suppressChangeDrivenSync > 0) return;
      if (settingsController.get("appleCalendarSyncEnabled") === true) scheduleSoon();
    }));
  }

  async function getStatus() {
    const snapshot = getSnapshot();
    const configured = await authStore.hasCredentials();
    const credsStatus = await authStore.getStoreStatus();
    return {
      configured,
      authorized: configured,
      maskedAppleId: credsStatus.maskedAppleId || "",
      calendars: cachedStatus.calendars || [],
      targetCalendarId: snapshot.appleCalendarTargetCalendarId || cachedStatus.targetCalendarId || "",
      targetCalendarName: snapshot.appleCalendarTargetCalendarName || cachedStatus.targetCalendarName || "",
      lastSyncAt: snapshot.appleCalendarLastSyncAt || cachedStatus.lastSyncAt || 0,
      lastSyncError: snapshot.appleCalendarLastSyncError || cachedStatus.lastSyncError || "",
      refreshMinutes: snapshot.appleCalendarSyncIntervalMinutes || DEFAULT_SYNC_INTERVAL_MINUTES,
      windowDays: snapshot.appleCalendarSyncWindowDays || DEFAULT_SYNC_WINDOW_DAYS,
      syncAllCalendars: snapshot.appleCalendarSyncAllCalendars === true,
      enabled: snapshot.appleCalendarSyncEnabled === true,
    };
  }

  async function listCalendars() {
    const creds = await getCreds();
    if (!creds) {
      return { status: "error", message: "Apple Calendar credentials are not configured", calendars: [] };
    }
    const discovery = await discoverCalendars(creds);
    cachedStatus = {
      ...cachedStatus,
      calendars: discovery.calendars,
      configured: true,
      authorized: true,
    };
    return { status: "ok", calendars: discovery.calendars };
  }

  function start() {
    if (started) return;
    started = true;
    subscribe();
    if (settingsController.get("appleCalendarSyncEnabled") === true) {
      scheduleSoon();
    }
  }

  function stop() {
    started = false;
    clearTimer();
    for (const off of unsubscribe) {
      if (typeof off === "function") {
        try { off(); } catch {}
      }
    }
    unsubscribe = [];
  }

  return {
    start,
    stop,
    syncNow: executeSync,
    listCalendars,
    getStatus,
    scheduleSoon,
  };
}

module.exports = { createAppleCalendarSyncRuntime };
