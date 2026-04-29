const assert = require("node:assert/strict");
const test = require("node:test");

const {
  expectedActionLabelForState,
  inferRobotStateFromSnapshot,
  normalizeAction,
  shouldSkipActionTap,
} = require("./robot_vacuum_controls.js");

test("normalizeAction accepts the supported command set and aliases", () => {
  assert.equal(normalizeAction("get_state"), "get_state");
  assert.equal(normalizeAction("state"), "get_state");
  assert.equal(normalizeAction("start"), "start");
  assert.equal(normalizeAction("pause"), "pause");
  assert.equal(normalizeAction("return_to_dock"), "return_to_dock");
  assert.equal(normalizeAction("dock"), "return_to_dock");
  assert.equal(normalizeAction("return-to-dock"), "return_to_dock");
  assert.equal(normalizeAction("nope"), null);
});

test("inferRobotStateFromSnapshot treats Start as paused", () => {
  const parsed = inferRobotStateFromSnapshot(`
    <hierarchy>
      <node text="Start" class="android.widget.TextView" />
      <node text="Docking" class="android.widget.TextView" />
    </hierarchy>
  `);
  assert.equal(parsed.state, "paused");
  assert.equal(parsed.primaryActionLabel, "Start");
  assert.equal(parsed.dockActionLabel, "Docking");
});

test("inferRobotStateFromSnapshot treats Pause as operating", () => {
  const parsed = inferRobotStateFromSnapshot(`
    <hierarchy>
      <node text="Pause" class="android.widget.TextView" />
      <node text="Docking" class="android.widget.TextView" />
    </hierarchy>
  `);
  assert.equal(parsed.state, "operating");
  assert.equal(parsed.primaryActionLabel, "Pause");
  assert.equal(parsed.dockActionLabel, "Docking");
});

test("expectedActionLabelForState maps the inferred state to the action label", () => {
  assert.equal(expectedActionLabelForState("paused"), "Start");
  assert.equal(expectedActionLabelForState("operating"), "Pause");
  assert.equal(expectedActionLabelForState("unknown"), null);
});

test("shouldSkipActionTap keys off the inferred robot state instead of the visible button label", () => {
  assert.equal(shouldSkipActionTap("start", "paused"), false);
  assert.equal(shouldSkipActionTap("start", "operating"), true);
  assert.equal(shouldSkipActionTap("pause", "paused"), true);
  assert.equal(shouldSkipActionTap("pause", "operating"), false);
});
