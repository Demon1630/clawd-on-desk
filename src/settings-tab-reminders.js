"use strict";

(function initSettingsTabReminders(root) {
  let state = null;
  let helpers = null;
  let ops = null;

  const view = {
    editingId: null,
    draft: blankDraft(),
    apple: {
      status: null,
      loading: false,
      calendarsLoading: false,
      savingCredentials: false,
      syncing: false,
      appleId: "",
      appPassword: "",
      calendars: [],
    },
  };

  function t(key) {
    return helpers.t(key);
  }

  function blankDraft() {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    future.setMinutes(future.getMinutes() - (future.getMinutes() % 5), 0, 0);
    return {
      title: "",
      dueAt: toLocalInputValue(future.getTime()),
      note: "",
    };
  }

  function listReminders() {
    const snap = state.snapshot || {};
    const map = snap.reminders && typeof snap.reminders === "object" ? snap.reminders : {};
    return Object.values(map)
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt);
  }

  function toLocalInputValue(ts) {
    const d = new Date(ts);
    if (Number.isNaN(d.getTime())) return "";
    const pad = (n) => String(n).padStart(2, "0");
    return [
      d.getFullYear(),
      pad(d.getMonth() + 1),
      pad(d.getDate()),
    ].join("-") + "T" + [pad(d.getHours()), pad(d.getMinutes())].join(":");
  }

  function fromLocalInputValue(value) {
    if (typeof value !== "string" || !value) return null;
    const ts = new Date(value).getTime();
    return Number.isFinite(ts) ? ts : null;
  }

  function formatDateTime(ts) {
    try {
      return new Intl.DateTimeFormat(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(ts));
    } catch {
      return toLocalInputValue(ts);
    }
  }

  function statusText(reminder) {
    if (reminder.done) return t("remindersStatusDone");
    if (Number.isFinite(reminder.dueAt) && reminder.dueAt <= Date.now()) return t("remindersStatusOverdue");
    return t("remindersStatusUpcoming");
  }

  function statusClass(reminder) {
    if (reminder.done) return "done";
    if (Number.isFinite(reminder.dueAt) && reminder.dueAt <= Date.now()) return "overdue";
    return "upcoming";
  }

  function callCommand(action, payload) {
    if (!window.settingsAPI || typeof window.settingsAPI.command !== "function") {
      return Promise.resolve({ status: "error", message: "settings API unavailable" });
    }
    return window.settingsAPI.command(action, payload).then((result) => {
      if (!result || result.status !== "ok") {
        const message = (result && result.message) || "unknown error";
        ops.showToast(message, { error: true });
      }
      return result;
    }).catch((err) => {
      const message = err && err.message ? err.message : "unknown error";
      ops.showToast(message, { error: true });
      return { status: "error", message };
    });
  }

  function callUpdate(key, value) {
    if (!window.settingsAPI || typeof window.settingsAPI.update !== "function") {
      return Promise.resolve({ status: "error", message: "settings API unavailable" });
    }
    return window.settingsAPI.update(key, value).then((result) => {
      if (!result || result.status !== "ok") {
        const message = (result && result.message) || "unknown error";
        ops.showToast(message, { error: true });
      }
      return result;
    }).catch((err) => {
      const message = err && err.message ? err.message : "unknown error";
      ops.showToast(message, { error: true });
      return { status: "error", message };
    });
  }

  function startEdit(reminder) {
    view.editingId = reminder ? reminder.id : null;
    view.draft = reminder ? {
      title: reminder.title || "",
      dueAt: toLocalInputValue(reminder.dueAt || Date.now()),
      note: reminder.note || "",
    } : blankDraft();
    ops.requestRender({ content: true });
  }

  function cancelEdit() {
    view.editingId = null;
    view.draft = blankDraft();
    ops.requestRender({ content: true });
  }

  function saveReminder() {
    const title = (view.draft.title || "").trim();
    const dueAt = fromLocalInputValue(view.draft.dueAt);
    const note = (view.draft.note || "").trim();
    if (!title) {
      ops.showToast(t("remindersErrorMissingTitle"), { error: true });
      return Promise.resolve();
    }
    if (!dueAt) {
      ops.showToast(t("remindersErrorMissingWhen"), { error: true });
      return Promise.resolve();
    }
    const payload = { title, dueAt, note };
    if (view.editingId) {
      payload.id = view.editingId;
      return callCommand("reminders.update", payload).then((result) => {
        if (result && result.status === "ok") {
          ops.showToast(t("remindersUpdated"));
          cancelEdit();
        }
      });
    }
    return callCommand("reminders.add", payload).then((result) => {
      if (result && result.status === "ok") {
        ops.showToast(t("remindersAdded"));
        cancelEdit();
      }
    });
  }

  function deleteReminder(reminder) {
    if (!window.confirm || !window.confirm(t("remindersDeleteConfirm").replace("{title}", reminder.title))) return;
    callCommand("reminders.delete", { id: reminder.id });
  }

  function toggleDone(reminder) {
    callCommand("reminders.setDone", { id: reminder.id, done: !reminder.done });
  }

  function snoozeReminder(reminder) {
    callCommand("reminders.snooze", { id: reminder.id, minutes: 10 });
  }

  function appleStatusSummary() {
    const status = view.apple.status || {};
    if (view.apple.loading) return t("appleCalendarStatusLoading");
    if (!status.configured) return t("appleCalendarStatusNotConfigured");
    if (status.lastSyncError) {
      return t("appleCalendarStatusError").replace("{message}", status.lastSyncError);
    }
    const target = status.targetCalendarName || status.targetCalendarId || t("appleCalendarStatusCalendarUnknown");
    const lastSync = status.lastSyncAt ? formatDateTime(status.lastSyncAt) : t("appleCalendarStatusNeverSynced");
    return t("appleCalendarStatusReady")
      .replace("{appleId}", status.maskedAppleId || "")
      .replace("{calendar}", target)
      .replace("{lastSync}", lastSync);
  }

  function refreshAppleStatus({ forceRender = false } = {}) {
    if (view.apple.loading) return Promise.resolve();
    view.apple.loading = true;
    if (forceRender) ops.requestRender({ content: true });
    return callCommand("appleCalendar.status").then((result) => {
      view.apple.loading = false;
      if (!result || result.status !== "ok") {
        view.apple.status = { configured: false };
        view.apple.calendars = [];
        if (forceRender) ops.requestRender({ content: true });
        return;
      }
      view.apple.status = result;
      if (result.calendars && Array.isArray(result.calendars)) {
        view.apple.calendars = result.calendars;
      }
      if (forceRender) ops.requestRender({ content: true });
      if (result.configured) {
        return refreshAppleCalendars({ forceRender: false });
      }
      view.apple.calendars = [];
      return null;
    }).catch(() => {
      view.apple.loading = false;
      view.apple.status = { configured: false };
      view.apple.calendars = [];
      if (forceRender) ops.requestRender({ content: true });
    });
  }

  function refreshAppleCalendars({ forceRender = false } = {}) {
    if (view.apple.calendarsLoading) return Promise.resolve();
    view.apple.calendarsLoading = true;
    if (forceRender) ops.requestRender({ content: true });
    return callCommand("appleCalendar.listCalendars").then((result) => {
      view.apple.calendarsLoading = false;
      if (result && result.status === "ok" && Array.isArray(result.calendars)) {
        view.apple.calendars = result.calendars;
        const current = state.snapshot || {};
        const currentId = current.appleCalendarTargetCalendarId || "";
        const selected = view.apple.calendars.find((calendar) => calendar.id === currentId) || view.apple.calendars[0] || null;
        if (selected && selected.id !== currentId) {
          callUpdate("appleCalendarTargetCalendarId", selected.id);
          callUpdate("appleCalendarTargetCalendarName", selected.displayName || "");
        }
      }
      if (forceRender) ops.requestRender({ content: true });
    }).catch(() => {
      view.apple.calendarsLoading = false;
      if (forceRender) ops.requestRender({ content: true });
    });
  }

  function saveAppleCredentials() {
    const appleId = (view.apple.appleId || "").trim();
    const appPassword = (view.apple.appPassword || "").trim();
    if (!appleId) {
      ops.showToast(t("appleCalendarAppleIdMissing"), { error: true });
      return Promise.resolve();
    }
    if (!appPassword) {
      ops.showToast(t("appleCalendarAppPasswordMissing"), { error: true });
      return Promise.resolve();
    }
    view.apple.savingCredentials = true;
    ops.requestRender({ content: true });
    return callCommand("appleCalendar.setCredentials", { appleId, appPassword }).then((result) => {
      view.apple.savingCredentials = false;
      if (!result || result.status !== "ok") {
        ops.requestRender({ content: true });
        return;
      }
      ops.showToast(t("appleCalendarCredentialsSaved"));
      view.apple.appPassword = "";
      return refreshAppleStatus({ forceRender: true });
    }).catch((err) => {
      view.apple.savingCredentials = false;
      ops.showToast((err && err.message) || t("appleCalendarCredentialsSaveFailed"), { error: true });
      ops.requestRender({ content: true });
    });
  }

  function clearAppleCredentials() {
    if (!window.confirm || !window.confirm(t("appleCalendarClearConfirm"))) return Promise.resolve();
    return callCommand("appleCalendar.clearCredentials").then((result) => {
      if (!result || result.status !== "ok") return;
      view.apple.appleId = "";
      view.apple.appPassword = "";
      view.apple.status = { configured: false };
      view.apple.calendars = [];
      ops.requestRender({ content: true });
    });
  }

  function syncAppleNow() {
    view.apple.syncing = true;
    ops.requestRender({ content: true });
    return callCommand("appleCalendar.syncNow", { reason: "manual" }).then((result) => {
      view.apple.syncing = false;
      if (!result || result.status !== "ok") {
        ops.requestRender({ content: true });
        return;
      }
      ops.showToast(t("appleCalendarSyncStarted"));
      return refreshAppleStatus({ forceRender: true });
    }).catch((err) => {
      view.apple.syncing = false;
      ops.showToast((err && err.message) || t("appleCalendarSyncFailed"), { error: true });
      ops.requestRender({ content: true });
    });
  }

  function saveTargetCalendar(calendarId) {
    const selected = view.apple.calendars.find((calendar) => calendar.id === calendarId) || null;
    return Promise.all([
      callUpdate("appleCalendarTargetCalendarId", selected ? selected.id : ""),
      callUpdate("appleCalendarTargetCalendarName", selected ? (selected.displayName || "") : ""),
    ]);
  }

  function buildAppleCredentialsRow() {
    const row = document.createElement("div");
    row.className = "row apple-calendar-credentials-row";

    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("appleCalendarCredentialsLabel");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = t("appleCalendarCredentialsDesc");
    text.appendChild(label);
    text.appendChild(desc);
    row.appendChild(text);

    const ctrl = document.createElement("div");
    ctrl.className = "row-control apple-calendar-credentials-control";
    const appleInput = document.createElement("input");
    appleInput.type = "text";
    appleInput.spellcheck = false;
    appleInput.autocomplete = "off";
    appleInput.placeholder = t("appleCalendarAppleIdPlaceholder");
    appleInput.value = view.apple.appleId;
    appleInput.addEventListener("input", () => { view.apple.appleId = appleInput.value; });

    const passwordInput = document.createElement("input");
    passwordInput.type = "password";
    passwordInput.spellcheck = false;
    passwordInput.autocomplete = "new-password";
    passwordInput.placeholder = t("appleCalendarAppPasswordPlaceholder");
    passwordInput.value = view.apple.appPassword;
    passwordInput.addEventListener("input", () => { view.apple.appPassword = passwordInput.value; });

    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "soft-btn accent";
    saveBtn.disabled = view.apple.savingCredentials;
    saveBtn.textContent = view.apple.savingCredentials ? t("appleCalendarSaving") : t("appleCalendarSaveCredentials");
    saveBtn.addEventListener("click", () => saveAppleCredentials());

    const clearBtn = document.createElement("button");
    clearBtn.type = "button";
    clearBtn.className = "soft-btn";
    clearBtn.textContent = t("appleCalendarClearCredentials");
    clearBtn.addEventListener("click", () => clearAppleCredentials());

    ctrl.appendChild(appleInput);
    ctrl.appendChild(passwordInput);
    ctrl.appendChild(saveBtn);
    ctrl.appendChild(clearBtn);
    row.appendChild(ctrl);
    return row;
  }

  function buildAppleCalendarSelectRow() {
    const row = document.createElement("div");
    row.className = "row apple-calendar-target-row";

    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("appleCalendarTargetLabel");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = view.apple.calendarsLoading
      ? t("appleCalendarLoadingCalendars")
      : t("appleCalendarTargetDesc");
    text.appendChild(label);
    text.appendChild(desc);
    row.appendChild(text);

    const ctrl = document.createElement("div");
    ctrl.className = "row-control apple-calendar-target-control";
    const select = document.createElement("select");
    select.className = "apple-calendar-select";
    const current = (state.snapshot && state.snapshot.appleCalendarTargetCalendarId) || "";
    const syncAll = state.snapshot && state.snapshot.appleCalendarSyncAllCalendars === true;
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = t("appleCalendarTargetAuto");
    select.appendChild(placeholder);
    select.classList.toggle("apple-calendar-select-muted", syncAll);
    for (const calendar of view.apple.calendars) {
      const option = document.createElement("option");
      option.value = calendar.id;
      option.textContent = calendar.displayName || calendar.id;
      if (calendar.id === current) option.selected = true;
      select.appendChild(option);
    }
    select.addEventListener("change", () => {
      saveTargetCalendar(select.value);
    });

    const refreshBtn = document.createElement("button");
    refreshBtn.type = "button";
    refreshBtn.className = "soft-btn";
    refreshBtn.textContent = view.apple.calendarsLoading ? t("appleCalendarRefreshing") : t("appleCalendarRefreshCalendars");
    refreshBtn.disabled = view.apple.calendarsLoading;
    refreshBtn.addEventListener("click", () => refreshAppleCalendars({ forceRender: true }));

    ctrl.appendChild(select);
    ctrl.appendChild(refreshBtn);
    row.appendChild(ctrl);
    return row;
  }

  function buildAppleStatusRow() {
    const row = document.createElement("div");
    row.className = "row apple-calendar-status-row";
    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("appleCalendarStatusLabel");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = appleStatusSummary();
    text.appendChild(label);
    text.appendChild(desc);
    row.appendChild(text);

    const ctrl = document.createElement("div");
    ctrl.className = "row-control";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "soft-btn accent";
    btn.disabled = view.apple.syncing;
    btn.textContent = view.apple.syncing ? t("appleCalendarSyncing") : t("appleCalendarSyncNow");
    btn.addEventListener("click", () => syncAppleNow());
    ctrl.appendChild(btn);
    row.appendChild(ctrl);
    return row;
  }

  function buildAppleSyncEnabledRow() {
    const row = document.createElement("div");
    row.className = "row";

    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("appleCalendarSyncEnabledLabel");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = t("appleCalendarSyncEnabledDesc");
    text.appendChild(label);
    text.appendChild(desc);
    row.appendChild(text);

    const ctrl = document.createElement("div");
    ctrl.className = "row-control";
    const sw = document.createElement("div");
    sw.className = "switch";
    sw.setAttribute("role", "switch");
    sw.setAttribute("tabindex", "0");
    const enabled = state.snapshot && state.snapshot.appleCalendarSyncEnabled === true;
    sw.classList.toggle("on", enabled);
    sw.setAttribute("aria-checked", enabled ? "true" : "false");

    const toggle = () => {
      callUpdate("appleCalendarSyncEnabled", !enabled).then((result) => {
        if (result && result.status === "ok") ops.requestRender({ content: true });
      });
    };
    sw.addEventListener("click", toggle);
    sw.addEventListener("keydown", (ev) => {
      if (ev.key === " " || ev.key === "Enter") {
        ev.preventDefault();
        toggle();
      }
    });

    ctrl.appendChild(sw);
    row.appendChild(ctrl);
    return row;
  }

  function buildAppleSyncAllCalendarsRow() {
    const row = document.createElement("div");
    row.className = "row";

    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("appleCalendarSyncAllCalendarsLabel");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = t("appleCalendarSyncAllCalendarsDesc");
    text.appendChild(label);
    text.appendChild(desc);
    row.appendChild(text);

    const ctrl = document.createElement("div");
    ctrl.className = "row-control";
    const sw = document.createElement("div");
    sw.className = "switch";
    sw.setAttribute("role", "switch");
    sw.setAttribute("tabindex", "0");
    const enabled = state.snapshot && state.snapshot.appleCalendarSyncAllCalendars === true;
    sw.classList.toggle("on", enabled);
    sw.setAttribute("aria-checked", enabled ? "true" : "false");

    const toggle = () => {
      callUpdate("appleCalendarSyncAllCalendars", !enabled).then((result) => {
        if (result && result.status === "ok") ops.requestRender({ content: true });
      });
    };
    sw.addEventListener("click", toggle);
    sw.addEventListener("keydown", (ev) => {
      if (ev.key === " " || ev.key === "Enter") {
        ev.preventDefault();
        toggle();
      }
    });

    ctrl.appendChild(sw);
    row.appendChild(ctrl);
    return row;
  }

  function buildAppleRefreshIntervalRow() {
    const row = document.createElement("div");
    row.className = "row";

    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("appleCalendarRefreshLabel");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = t("appleCalendarRefreshDesc");
    text.appendChild(label);
    text.appendChild(desc);
    row.appendChild(text);

    const ctrl = document.createElement("div");
    ctrl.className = "row-control apple-calendar-refresh-control";
    const input = document.createElement("input");
    input.type = "number";
    input.min = "5";
    input.max = "240";
    input.step = "1";
    input.value = String((state.snapshot && state.snapshot.appleCalendarSyncIntervalMinutes) || 15);

    const save = () => {
      const value = Number.parseInt(input.value, 10);
      if (!Number.isInteger(value) || value < 5 || value > 240) {
        ops.showToast("5-240", { error: true });
        input.value = String((state.snapshot && state.snapshot.appleCalendarSyncIntervalMinutes) || 15);
        return;
      }
      callUpdate("appleCalendarSyncIntervalMinutes", value);
    };

    input.addEventListener("blur", save);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        save();
      }
    });

    const unit = document.createElement("span");
    unit.className = "apple-calendar-refresh-unit";
    unit.textContent = "min";

    ctrl.appendChild(input);
    ctrl.appendChild(unit);
    row.appendChild(ctrl);
    return row;
  }

  function renderListRows() {
    const reminders = listReminders();
    if (reminders.length === 0) {
      const empty = document.createElement("div");
      empty.className = "reminders-empty";
      empty.textContent = t("remindersEmpty");
      return [empty];
    }
    return reminders.map((reminder) => renderReminderCard(reminder));
  }

  function renderAppleRows() {
    return [
      buildAppleStatusRow(),
      buildAppleCredentialsRow(),
      buildAppleSyncEnabledRow(),
      buildAppleRefreshIntervalRow(),
      buildAppleWindowDaysRow(),
      buildAppleSyncAllCalendarsRow(),
      buildAppleCalendarSelectRow(),
    ];
  }

  function replaceSectionRows(section, rows) {
    if (!section) return false;
    const wrap = section.querySelector(".section-rows");
    if (!wrap) return false;
    wrap.innerHTML = "";
    for (const row of rows) wrap.appendChild(row);
    return true;
  }

  function patchInPlace(changes) {
    const keys = changes ? Object.keys(changes) : [];
    if (!keys.length) return false;

    const canPatch = keys.every((key) => [
      "reminders",
      "appleCalendarLastSyncAt",
      "appleCalendarLastSyncError",
      "appleCalendarDeletionTombstones",
      "appleCalendarTargetCalendarId",
      "appleCalendarTargetCalendarName",
      "appleCalendarSyncAllCalendars",
    ].includes(key));
    if (!canPatch) return false;

    const listSection = document.querySelector(".reminders-list-section");
    const appleSection = document.querySelector(".apple-calendar-section");
    if (!listSection || !appleSection) return false;

    if (keys.includes("reminders")) {
      if (!replaceSectionRows(listSection, renderListRows())) return false;
    }
    if (keys.some((key) => key !== "reminders")) {
      if (!replaceSectionRows(appleSection, renderAppleRows())) return false;
    }
    return true;
  }

  function buildAppleWindowDaysRow() {
    const row = document.createElement("div");
    row.className = "row";

    const text = document.createElement("div");
    text.className = "row-text";
    const label = document.createElement("span");
    label.className = "row-label";
    label.textContent = t("appleCalendarWindowDaysLabel");
    const desc = document.createElement("span");
    desc.className = "row-desc";
    desc.textContent = t("appleCalendarWindowDaysDesc");
    text.appendChild(label);
    text.appendChild(desc);
    row.appendChild(text);

    const ctrl = document.createElement("div");
    ctrl.className = "row-control apple-calendar-refresh-control";
    const input = document.createElement("input");
    input.type = "number";
    input.min = "1";
    input.max = "30";
    input.step = "1";
    input.value = String((state.snapshot && state.snapshot.appleCalendarSyncWindowDays) || 7);

    const save = () => {
      const value = Number.parseInt(input.value, 10);
      if (!Number.isInteger(value) || value < 1 || value > 30) {
        ops.showToast("1-30", { error: true });
        input.value = String((state.snapshot && state.snapshot.appleCalendarSyncWindowDays) || 7);
        return;
      }
      callUpdate("appleCalendarSyncWindowDays", value);
    };

    input.addEventListener("blur", save);
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") {
        ev.preventDefault();
        save();
      }
    });

    const unit = document.createElement("span");
    unit.className = "apple-calendar-refresh-unit";
    unit.textContent = t("appleCalendarWindowDaysUnit");

    ctrl.appendChild(input);
    ctrl.appendChild(unit);
    row.appendChild(ctrl);
    return row;
  }

  function renderReminderCard(reminder) {
    const card = document.createElement("div");
    card.className = "reminders-card";

    const title = document.createElement("div");
    title.className = "reminders-card-title";
    title.textContent = reminder.title;

    const meta = document.createElement("div");
    meta.className = "reminders-card-meta";

    const when = document.createElement("div");
    when.className = "reminders-card-when";
    when.textContent = formatDateTime(reminder.dueAt);

    const status = document.createElement("span");
    status.className = "reminders-status " + statusClass(reminder);
    status.textContent = statusText(reminder);
    meta.appendChild(when);
    meta.appendChild(status);

    if (reminder.note) {
      const note = document.createElement("div");
      note.className = "reminders-card-note";
      note.textContent = reminder.note;
      card.appendChild(note);
    }

    const actions = document.createElement("div");
    actions.className = "reminders-card-actions";

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "soft-btn";
    doneBtn.textContent = reminder.done ? t("remindersMarkActive") : t("remindersMarkDone");
    doneBtn.addEventListener("click", () => toggleDone(reminder));

    const snoozeBtn = document.createElement("button");
    snoozeBtn.type = "button";
    snoozeBtn.className = "soft-btn";
    snoozeBtn.textContent = t("remindersSnooze10m");
    snoozeBtn.disabled = reminder.done;
    snoozeBtn.addEventListener("click", () => snoozeReminder(reminder));

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "soft-btn";
    editBtn.textContent = t("remindersEdit");
    editBtn.addEventListener("click", () => startEdit(reminder));

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "soft-btn danger";
    deleteBtn.textContent = t("remindersDelete");
    deleteBtn.addEventListener("click", () => deleteReminder(reminder));

    actions.appendChild(doneBtn);
    actions.appendChild(snoozeBtn);
    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(title);
    card.appendChild(meta);
    card.appendChild(actions);
    return card;
  }

  function renderFormCard() {
    const card = document.createElement("div");
    card.className = "reminders-form-card";

    const title = document.createElement("div");
    title.className = "reminders-form-title";
    title.textContent = view.editingId ? t("remindersEditTitle") : t("remindersAddTitle");
    card.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "reminders-form-grid";

    const titleField = document.createElement("label");
    titleField.className = "reminders-field";
    titleField.innerHTML = `<span>${helpers.escapeHtml(t("remindersTitleLabel"))}</span>`;
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = view.draft.title;
    titleInput.placeholder = t("remindersTitlePlaceholder");
    titleInput.addEventListener("input", () => { view.draft.title = titleInput.value; });
    titleField.appendChild(titleInput);

    const whenField = document.createElement("label");
    whenField.className = "reminders-field";
    whenField.innerHTML = `<span>${helpers.escapeHtml(t("remindersWhenLabel"))}</span>`;
    const whenInput = document.createElement("input");
    whenInput.type = "datetime-local";
    whenInput.value = view.draft.dueAt;
    whenInput.addEventListener("input", () => { view.draft.dueAt = whenInput.value; });
    whenField.appendChild(whenInput);

    const noteField = document.createElement("label");
    noteField.className = "reminders-field reminders-field-note";
    noteField.innerHTML = `<span>${helpers.escapeHtml(t("remindersNoteLabel"))}</span>`;
    const noteInput = document.createElement("textarea");
    noteInput.rows = 3;
    noteInput.value = view.draft.note;
    noteInput.placeholder = t("remindersNotePlaceholder");
    noteInput.addEventListener("input", () => { view.draft.note = noteInput.value; });
    noteField.appendChild(noteInput);

    grid.appendChild(titleField);
    grid.appendChild(whenField);
    grid.appendChild(noteField);
    card.appendChild(grid);

    const actions = document.createElement("div");
    actions.className = "reminders-form-actions";
    const saveBtn = document.createElement("button");
    saveBtn.type = "button";
    saveBtn.className = "soft-btn accent";
    saveBtn.textContent = view.editingId ? t("remindersSave") : t("remindersAdd");
    saveBtn.addEventListener("click", saveReminder);
    const cancelBtn = document.createElement("button");
    cancelBtn.type = "button";
    cancelBtn.className = "soft-btn";
    cancelBtn.textContent = t("remindersCancel");
    cancelBtn.addEventListener("click", cancelEdit);
    actions.appendChild(saveBtn);
    actions.appendChild(cancelBtn);
    card.appendChild(actions);
    return card;
  }

  function render(parent) {
    const h1 = document.createElement("h1");
    h1.textContent = t("remindersTitle");
    parent.appendChild(h1);

    const subtitle = document.createElement("p");
    subtitle.className = "subtitle";
    subtitle.textContent = t("remindersSubtitle");
    parent.appendChild(subtitle);

    parent.appendChild(helpers.buildSection(t("remindersSectionNew"), [renderFormCard()]));

    const listSection = helpers.buildSection(t("remindersSectionList"), renderListRows());
    listSection.classList.add("reminders-list-section");
    parent.appendChild(listSection);

    const appleSection = helpers.buildSection(t("appleCalendarSectionTitle"), renderAppleRows());
    appleSection.classList.add("apple-calendar-section");
    parent.appendChild(appleSection);

    if (!view.apple.status && !view.apple.loading) {
      void refreshAppleStatus();
    }
  }

  function init(core) {
    state = core.state;
    helpers = core.helpers;
    ops = core.ops;
    core.tabs.reminders = {
      render,
      patchInPlace,
    };
  }

  root.ClawdSettingsTabReminders = { init };
})(globalThis);
