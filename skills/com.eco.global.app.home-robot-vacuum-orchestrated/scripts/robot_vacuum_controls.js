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

function inferRobotStateFromSnapshot(snapshotText) {
  const text = String(snapshotText || "");
  if (/\bPause\b/.test(text)) {
    return {
      state: "operating",
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
  if (state === "operating") return "Pause";
  return null;
}

function shouldSkipActionTap(requestedAction, observedState) {
  if (requestedAction === "start") return observedState === "operating";
  if (requestedAction === "pause") return observedState === "paused";
  return false;
}

module.exports = {
  ACTIONS,
  expectedActionLabelForState,
  inferRobotStateFromSnapshot,
  normalizeAction,
  normalizeText,
  shouldSkipActionTap,
};
