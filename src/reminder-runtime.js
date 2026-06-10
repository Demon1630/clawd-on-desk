"use strict";

function createReminderRuntime(options = {}) {
  const settingsController = options.settingsController;
  const Notification = options.Notification;
  const getLang = typeof options.getLang === "function" ? options.getLang : () => "en";
  const showPetSign = typeof options.showPetSign === "function" ? options.showPetSign : null;
  const log = typeof options.log === "function" ? options.log : () => {};
  const now = typeof options.now === "function" ? options.now : Date.now;

  if (!settingsController) {
    throw new Error("createReminderRuntime requires settingsController");
  }

  let started = false;
  let timer = null;
  let unsubscribe = null;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function reminderList(snapshot) {
    const map = snapshot && snapshot.reminders && typeof snapshot.reminders === "object"
      ? snapshot.reminders
      : {};
    return Object.values(map)
      .filter((item) => item && typeof item === "object" && !Array.isArray(item))
      .map((item) => ({ ...item }))
      .filter((item) => item.id && item.title && Number.isFinite(item.dueAt))
      .sort((a, b) => a.dueAt - b.dueAt || a.createdAt - b.createdAt);
  }

  function isDue(item, ts) {
    if (!item || item.done === true) return false;
    if (!Number.isFinite(item.dueAt) || item.dueAt <= 0) return false;
    if (!Number.isFinite(item.notifiedAt) || item.notifiedAt <= 0) return item.dueAt <= ts;
    return item.notifiedAt < item.dueAt && item.dueAt <= ts;
  }

  function markNotified(items, firedAt) {
    const snapshot = settingsController.getSnapshot();
    const current = snapshot && snapshot.reminders && typeof snapshot.reminders === "object"
      ? snapshot.reminders
      : {};
    let changed = false;
    const next = { ...current };
    for (const item of items) {
      const existing = current[item.id];
      if (!existing) continue;
      if (existing.done === true) continue;
      if (!Number.isFinite(existing.dueAt) || existing.dueAt !== item.dueAt) continue;
      if (Number.isFinite(existing.notifiedAt) && existing.notifiedAt >= existing.dueAt) continue;
      next[item.id] = { ...existing, notifiedAt: firedAt };
      changed = true;
    }
    if (changed) {
      const result = settingsController.applyUpdate("reminders", next);
      if (!result || result.status !== "ok") {
        log(`reminders: failed to persist notification state: ${result && result.message}`);
      }
    }
  }
  function showReminder(item) {
    const title = item.title || "Reminder";
    const lang = getLang() || "en";
    const isZh = lang === "zh" || lang === "zh-TW";
    const strings = isZh
      ? { prefix: "Clawd 提醒", fallback: "提醒到时间了。" }
      : { prefix: "Clawd reminder", fallback: "Reminder is due." };
    if (showPetSign) {
      try {
        const sent = showPetSign({
          id: item.id,
          title,
          note: item.note || "",
          dueAt: item.dueAt,
          durationMs: 8000,
        });
        if (sent !== false) return;
      } catch (err) {
        log(`reminders: pet sign failed: ${err && err.message}`);
      }
    }
    try {
      if (!Notification || typeof Notification !== "function") return;
      if (Notification && typeof Notification.isSupported === "function" && !Notification.isSupported()) {
        return;
      }
      const n = new Notification({
        title: `${strings.prefix}: ${title}`,
        body: item.note ? item.note : strings.fallback,
        silent: false,
      });
      if (n && typeof n.show === "function") n.show();
    } catch (err) {
      log(`reminders: notification failed: ${err && err.message}`);
    }
  }

  function schedule() {
    if (!started) return;
    clearTimer();
    const snapshot = settingsController.getSnapshot();
    const list = reminderList(snapshot);
    const ts = now();
    const due = list.filter((item) => isDue(item, ts));
    if (due.length > 0) {
      for (const item of due) showReminder(item);
      markNotified(due, ts);
      timer = setTimeout(schedule, 0);
      if (timer && typeof timer.unref === "function") timer.unref();
      return;
    }
    let nextDue = null;
    for (const item of list) {
      if (item.done === true) continue;
      if (Number.isFinite(item.notifiedAt) && item.notifiedAt >= item.dueAt) continue;
      if (!Number.isFinite(nextDue) || item.dueAt < nextDue) nextDue = item.dueAt;
    }
    if (!Number.isFinite(nextDue)) return;
    const delay = Math.max(0, nextDue - ts);
    timer = setTimeout(schedule, delay);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function start() {
    if (started) return;
    started = true;
    unsubscribe = settingsController.subscribeKey("reminders", schedule);
    schedule();
  }

  function stop() {
    started = false;
    clearTimer();
    if (typeof unsubscribe === "function") unsubscribe();
    unsubscribe = null;
  }

  return {
    start,
    stop,
    schedule,
  };
}

module.exports = { createReminderRuntime };
