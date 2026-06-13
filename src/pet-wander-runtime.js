"use strict";

function createPetWanderRuntime(options = {}) {
  const settingsController = options.settingsController;
  const petWindowRuntime = options.petWindowRuntime;
  const getCurrentState = typeof options.getCurrentState === "function" ? options.getCurrentState : () => "";
  const getMiniMode = typeof options.getMiniMode === "function" ? options.getMiniMode : () => false;
  const getMiniTransitioning = typeof options.getMiniTransitioning === "function" ? options.getMiniTransitioning : () => false;
  const getDragLocked = typeof options.getDragLocked === "function" ? options.getDragLocked : () => false;
  const getMenuOpen = typeof options.getMenuOpen === "function" ? options.getMenuOpen : () => false;
  const getMouseOverPet = typeof options.getMouseOverPet === "function" ? options.getMouseOverPet : () => false;
  const getPetHidden = typeof options.getPetHidden === "function" ? options.getPetHidden : () => false;
  const getNearestWorkArea = typeof options.getNearestWorkArea === "function" ? options.getNearestWorkArea : () => null;
  const persistPosition = typeof options.persistPosition === "function" ? options.persistPosition : () => {};
  const onMotionStart = typeof options.onMotionStart === "function" ? options.onMotionStart : () => {};
  const onMotionEnd = typeof options.onMotionEnd === "function" ? options.onMotionEnd : () => {};
  const log = typeof options.log === "function" ? options.log : () => {};
  const now = typeof options.now === "function" ? options.now : Date.now;

  if (!settingsController) throw new Error("createPetWanderRuntime requires settingsController");
  if (!petWindowRuntime) throw new Error("createPetWanderRuntime requires petWindowRuntime");

  let started = false;
  let timer = null;
  let motionTimer = null;
  let nextWanderAt = 0;
  let lastPersistAt = 0;
  let motionActive = false;
  const unsubscribers = [];

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function clearMotionTimer() {
    if (motionTimer) clearTimeout(motionTimer);
    motionTimer = null;
  }

  function randomInt(min, max) {
    const lo = Math.ceil(Math.min(min, max));
    const hi = Math.floor(Math.max(min, max));
    return Math.floor(Math.random() * (hi - lo + 1)) + lo;
  }

  function isEnabled() {
    return settingsController.get("petWanderEnabled") === true;
  }

  function canWander() {
    if (!isEnabled()) return false;
    if (getPetHidden()) return false;
    if (getMiniMode() || getMiniTransitioning()) return false;
    if (getDragLocked() || getMenuOpen() || getMouseOverPet()) return false;
    return getCurrentState() === "idle";
  }

  function schedule(delayMs) {
    if (!started) return;
    clearTimer();
    const delay = Math.max(250, Number.isFinite(delayMs) ? Math.round(delayMs) : 5000);
    timer = setTimeout(tick, delay);
    if (timer && typeof timer.unref === "function") timer.unref();
  }

  function scheduleAfterRest() {
    nextWanderAt = now() + randomInt(18000, 32000);
    schedule(nextWanderAt - now());
  }

  function maybePersistPosition() {
    const ts = now();
    if (ts - lastPersistAt < 3000) return;
    lastPersistAt = ts;
    try {
      persistPosition();
    } catch (err) {
      log(`pet wander: persist failed: ${err && err.message}`);
    }
  }

  function chooseDestination(bounds) {
    if (!bounds) return null;
    const workArea = getNearestWorkArea(
      bounds.x + bounds.width / 2,
      bounds.y + bounds.height / 2
    );
    if (!workArea) return null;

    const margin = 24;
    const minX = Math.round(workArea.x + margin);
    const maxX = Math.round(workArea.x + workArea.width - bounds.width - margin);
    if (maxX <= minX) return null;

    const span = Math.max(80, Math.round(workArea.width * 0.18));
    const currentX = Math.round(bounds.x);
    const targetLeft = Math.max(minX, currentX - randomInt(span, Math.max(span + 1, Math.round(workArea.width * 0.35))));
    const targetRight = Math.min(maxX, currentX + randomInt(span, Math.max(span + 1, Math.round(workArea.width * 0.35))));
    let targetX = Math.random() < 0.5 ? targetLeft : targetRight;
    if (Math.abs(targetX - currentX) < 60) {
      targetX = targetX < currentX ? minX : maxX;
    }

    const clamped = petWindowRuntime.clampToScreenVisual(targetX, bounds.y, bounds.width, bounds.height);
    return clamped ? { x: clamped.x, y: clamped.y } : null;
  }

  function finishMotion(success) {
    clearMotionTimer();
    if (motionActive) {
      motionActive = false;
      try { onMotionEnd(); } catch {}
    }
    if (success) maybePersistPosition();
    scheduleAfterRest();
  }

  function animateTo(fromBounds, target) {
    const dx = target.x - fromBounds.x;
    const dy = target.y - fromBounds.y;
    const distance = Math.hypot(dx, dy);
    if (!Number.isFinite(distance) || distance < 40) {
      scheduleAfterRest();
      return;
    }

    const durationMs = Math.max(3500, Math.min(9000, Math.round(distance * 18)));
    const startedAt = now();
    const lockedSize = { width: fromBounds.width, height: fromBounds.height };
    motionActive = true;
    try { onMotionStart(dx < 0 ? "left" : "right"); } catch {}

    const step = () => {
      if (!started || !canWander()) {
        finishMotion(false);
        return;
      }
      const t = Math.min(1, (now() - startedAt) / durationMs);
      const eased = t < 0.5
        ? 2 * t * t
        : 1 - Math.pow(-2 * t + 2, 2) / 2;
      const x = Math.round(fromBounds.x + dx * eased);
      const y = Math.round(fromBounds.y + dy * eased);
      const move = typeof petWindowRuntime.applyPetWindowPositionWithoutResize === "function"
        ? petWindowRuntime.applyPetWindowPositionWithoutResize
        : petWindowRuntime.applyPetWindowPosition;
      move(x, y, lockedSize);
      if (t >= 1) {
        finishMotion(true);
        return;
      }
      motionTimer = setTimeout(step, 33);
      if (motionTimer && typeof motionTimer.unref === "function") motionTimer.unref();
    };

    step();
  }

  function tick() {
    clearTimer();
    if (!started) return;
    if (!isEnabled()) {
      clearMotionTimer();
      nextWanderAt = 0;
      return;
    }
    if (!canWander()) {
      clearMotionTimer();
      schedule(5000);
      return;
    }
    const ts = now();
    if (nextWanderAt > ts) {
      schedule(nextWanderAt - ts);
      return;
    }
    const bounds = petWindowRuntime.getPetWindowBounds();
    const target = chooseDestination(bounds);
    if (!bounds || !target) {
      scheduleAfterRest();
      return;
    }
    try {
      animateTo(bounds, target);
    } catch (err) {
      log(`pet wander: animate failed: ${err && err.message}`);
      scheduleAfterRest();
    }
  }

  function start() {
    if (started) return;
    started = true;
    unsubscribers.push(settingsController.subscribeKey("petWanderEnabled", () => {
      clearMotionTimer();
      nextWanderAt = 0;
      tick();
    }));
    tick();
  }

  function stop() {
    started = false;
    clearTimer();
    clearMotionTimer();
    nextWanderAt = 0;
    while (unsubscribers.length > 0) {
      const unsubscribe = unsubscribers.pop();
      if (typeof unsubscribe === "function") unsubscribe();
    }
  }

  return {
    start,
    stop,
    tick,
  };
}

module.exports = { createPetWanderRuntime };
