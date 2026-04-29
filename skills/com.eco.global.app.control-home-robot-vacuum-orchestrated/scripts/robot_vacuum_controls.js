const ACTIONS = new Set(["get_state", "start", "pause", "return_to_dock"]);

function normalizeAction(raw) {
  const normalized = String(raw || "").trim().toLowerCase();
  if (ACTIONS.has(normalized)) return normalized;
  if (normalized === "get-state" || normalized === "state" || normalized === "read_state") return "get_state";
  if (normalized === "dock" || normalized === "docking" || normalized === "return-to-dock" || normalized === "return") {
    return "return_to_dock";
  }
  return null;
}

function normalizeText(raw) {
  return String(raw || "").replace(/\s+/g, " ").trim();
}

function isOfflineSnapshot(snapshotText) {
  const text = normalizeText(snapshotText).toLowerCase();
  return text.includes("offline") || text.includes("why is my device offline");
}

function extractBatteryPercentFromSnapshot(snapshotText) {
  const text = String(snapshotText || "");
  const match = text.match(/(^|[^0-9])(\d{1,3})%(?!\d)/);
  if (!match) return null;
  const value = Number.parseInt(match[2], 10);
  if (!Number.isFinite(value) || value < 0 || value > 100) return null;
  return value;
}

function inferRobotStateFromSnapshot(snapshotText) {
  const text = String(snapshotText || "");
  if (isOfflineSnapshot(text)) {
    return {
      state: "offline",
      primaryActionLabel: null,
      dockActionLabel: text.includes("Docking") ? "Docking" : null,
    };
  }
  if (/\bPause\b/.test(text)) {
    return {
      state: "running",
      primaryActionLabel: "Pause",
      dockActionLabel: text.includes("Docking") ? "Docking" : null,
    };
  }
  if (/\bStart\b/.test(text)) {
    return {
      state: "paused",
      primaryActionLabel: "Start",
      dockActionLabel: text.includes("Docking") ? "Docking" : null,
    };
  }
  return {
    state: null,
    primaryActionLabel: null,
    dockActionLabel: text.includes("Docking") ? "Docking" : null,
  };
}

function expectedActionLabelForState(state) {
  if (state === "paused") return "Start";
  if (state === "running") return "Pause";
  return null;
}

function shouldSkipActionTap(requestedAction, observedState) {
  if (requestedAction === "start") return observedState === "running";
  if (requestedAction === "pause") return observedState === "paused";
  return false;
}

module.exports = {
  ACTIONS,
  extractBatteryPercentFromSnapshot,
  expectedActionLabelForState,
  inferRobotStateFromSnapshot,
  normalizeAction,
  normalizeText,
  isOfflineSnapshot,
  shouldSkipActionTap,
};
