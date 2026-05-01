const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyPowerState,
  extractChoiceDialogState,
  extractHomeScreenState,
  parseChoiceArg,
  runCyclingSettingSkill,
  runPowerStateSkill,
  setAirTouchHomeControlsDepsForTest,
  shouldRetryPowerToggle,
} = require("./airtouch5_home_controls.js");

const HOME_XML = [
  "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
  "<hierarchy rotation=\"0\">",
  "  <node index=\"0\" text=\"\" resource-id=\"root\" class=\"android.view.View\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,0][1080,2340]\">",
  "    <node index=\"1\" text=\"\" resource-id=\"comp-home-single-ac\" class=\"android.view.View\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,402][1080,2052]\">",
  "      <node index=\"0\" text=\" \" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[48,462][312,726]\" />",
  "      <node index=\"1\" text=\"Cool\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[498,390][594,462]\" />",
  "      <node index=\"2\" text=\" \" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[414,462][678,726]\" />",
  "      <node index=\"3\" text=\"Low\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[831,390][921,462]\" />",
  "      <node index=\"4\" text=\" \" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[741,462][1008,726]\" />",
  "      <node index=\"5\" text=\"Set Point\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[48,798][237,870]\" />",
  "    </node>",
  "    <node index=\"2\" text=\"Home\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,2052][216,2220]\" />",
  "    <node index=\"3\" text=\"Zones\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[216,2052][432,2220]\" />",
  "    <node index=\"4\" text=\"Timer\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[432,2052][648,2220]\" />",
  "    <node index=\"5\" text=\"Programs\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[648,2052][864,2220]\" />",
  "    <node index=\"6\" text=\"Insights\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[864,2052][1080,2220]\" />",
  "  </node>",
  "</hierarchy>",
].join("\n");

const HOME_OFF_XML = [
  "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
  "<hierarchy rotation=\"0\">",
  "  <node index=\"0\" text=\"\" resource-id=\"root\" class=\"android.view.View\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,0][1080,2340]\">",
  "    <node index=\"1\" text=\"\" resource-id=\"comp-home-single-ac\" class=\"android.view.View\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,402][1080,2052]\">",
  "      <node index=\"0\" text=\" \" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[48,462][312,726]\" />",
  "    </node>",
  "    <node index=\"2\" text=\"Home\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,2052][216,2220]\" />",
  "    <node index=\"3\" text=\"Zones\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[216,2052][432,2220]\" />",
  "    <node index=\"4\" text=\"Timer\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[432,2052][648,2220]\" />",
  "    <node index=\"5\" text=\"Programs\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[648,2052][864,2220]\" />",
  "    <node index=\"6\" text=\"Insights\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[864,2052][1080,2220]\" />",
  "  </node>",
  "</hierarchy>",
].join("\n");

const HOME_HEAT_XML = HOME_XML.replace('text="Cool"', 'text="Heat"');

const HOME_WITH_PLACEHOLDER_XML = [
  "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
  "<hierarchy rotation=\"0\">",
  "  <node index=\"0\" text=\"\" resource-id=\"root\" class=\"android.view.View\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,0][1080,2340]\">",
  "    <node index=\"1\" text=\"\" resource-id=\"comp-home-single-ac\" class=\"android.view.View\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,402][1080,2052]\">",
  "      <node index=\"0\" text=\" \" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,462][264,726]\" />",
  "      <node index=\"1\" text=\" \" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[48,462][312,726]\" />",
  "      <node index=\"2\" text=\"Cool\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[498,390][594,462]\" />",
  "      <node index=\"3\" text=\" \" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[414,462][678,726]\" />",
  "      <node index=\"4\" text=\"Low\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[831,390][921,462]\" />",
  "      <node index=\"5\" text=\" \" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[741,462][1008,726]\" />",
  "      <node index=\"6\" text=\"Set Point\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[48,798][237,870]\" />",
  "    </node>",
  "    <node index=\"2\" text=\"Home\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,2052][216,2220]\" />",
  "    <node index=\"3\" text=\"Zones\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[216,2052][432,2220]\" />",
  "    <node index=\"4\" text=\"Timer\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[432,2052][648,2220]\" />",
  "    <node index=\"5\" text=\"Programs\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[648,2052][864,2220]\" />",
  "    <node index=\"6\" text=\"Insights\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[864,2052][1080,2220]\" />",
  "  </node>",
  "</hierarchy>",
].join("\n");

const MODE_DIALOG_XML = [
  "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
  "<hierarchy rotation=\"0\">",
  "  <node index=\"0\" text=\"\" resource-id=\"\" class=\"android.view.View\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,0][1080,2340]\">",
  "    <node index=\"1\" text=\"\" resource-id=\"\" class=\"android.app.AlertDialog\" package=\"au.com.polyaire.airtouch5\" bounds=\"[180,810][900,1530]\">",
  "      <node index=\"0\" text=\"Mode\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" clickable=\"false\" bounds=\"[444,1134][636,1206]\" />",
  "      <node index=\"1\" text=\"Auto\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" clickable=\"true\" bounds=\"[633,954][735,1026]\" />",
  "      <node index=\"2\" text=\"Dry\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" clickable=\"true\" bounds=\"[720,1206][792,1278]\" />",
  "      <node index=\"3\" text=\"Fan\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" clickable=\"true\" bounds=\"[498,1374][582,1446]\" />",
  "      <node index=\"4\" text=\"Heat\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" clickable=\"true\" bounds=\"[273,1206][375,1278]\" />",
  "      <node index=\"5\" text=\"Cool\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" clickable=\"true\" bounds=\"[348,954][444,1026]\" />",
  "    </node>",
  "  </node>",
  "</hierarchy>",
].join("\n");

function buildSnapshotResult(xml, foregroundPackage = "au.com.polyaire.airtouch5") {
  return JSON.stringify({
    envelope: {
      stepResults: [
        {
          actionType: "snapshot",
          data: {
            foreground_package: foregroundPackage,
            text: xml,
          },
        },
      ],
    },
  });
}

function buildJsonResult(data = {}) {
  return JSON.stringify(data);
}

function captureSkillResult(logLines) {
  const markerIndex = logLines.lastIndexOf("[Clawperator-Skill-Result]");
  assert.notStrictEqual(markerIndex, -1, "expected a skill result marker");
  return JSON.parse(logLines[markerIndex + 1]);
}

test("parseChoiceArg prefers an explicit named flag over positional fallbacks", () => {
  assert.strictEqual(
    parseChoiceArg(["--mode", "heat", "cool"], { flag: "--mode", allowedValues: ["cool", "heat", "fan", "dry", "auto"] }),
    "heat",
  );
});

test("parseChoiceArg skips values that belong to other named flags when using positional fallback", () => {
  assert.strictEqual(
    parseChoiceArg(["--device", "<device_serial>", "medium"], { flag: "--fan-level", allowedValues: ["auto", "low", "medium", "high"] }),
    "medium",
  );
});

test("extractHomeScreenState reads live mode and fan values from the Home screen", () => {
  const state = extractHomeScreenState(HOME_XML);

  assert.strictEqual(state.isHomeScreen, true);
  assert.strictEqual(state.looksPoweredOn, true);
  assert.strictEqual(state.modeValue, "cool");
  assert.strictEqual(state.fanLevelValue, "low");
  assert.deepStrictEqual(state.controlSlots.power, { left: 48, top: 462, right: 312, bottom: 726 });
  assert.deepStrictEqual(state.controlSlots.mode, { left: 414, top: 462, right: 678, bottom: 726 });
  assert.deepStrictEqual(state.controlSlots.fan, { left: 741, top: 462, right: 1008, bottom: 726 });
});

test("extractHomeScreenState marks the Home screen as powered off when live values are absent", () => {
  const state = extractHomeScreenState(HOME_OFF_XML);

  assert.strictEqual(state.isHomeScreen, true);
  assert.strictEqual(state.looksPoweredOn, false);
  assert.strictEqual(state.modeValue, null);
  assert.strictEqual(state.fanLevelValue, null);
  assert.deepStrictEqual(state.controlSlots.power, { left: 48, top: 462, right: 312, bottom: 726 });
});

test("extractHomeScreenState prefers label-matched controls over a stray placeholder tile", () => {
  const state = extractHomeScreenState(HOME_WITH_PLACEHOLDER_XML);

  assert.deepStrictEqual(state.controlSlots.power, { left: 48, top: 462, right: 312, bottom: 726 });
  assert.deepStrictEqual(state.controlSlots.mode, { left: 414, top: 462, right: 678, bottom: 726 });
  assert.deepStrictEqual(state.controlSlots.fan, { left: 741, top: 462, right: 1008, bottom: 726 });
});

test("extractChoiceDialogState reads clickable option labels from the AirTouch selector dialog", () => {
  const dialog = extractChoiceDialogState(MODE_DIALOG_XML, ["cool", "heat", "fan", "dry", "auto"]);

  assert.ok(dialog);
  assert.deepStrictEqual(dialog.options.map((option) => option.normalized), ["cool", "auto", "heat", "dry", "fan"]);
});

test("classifyPowerState distinguishes the observed AirTouch off and on button metrics", () => {
  assert.strictEqual(
    classifyPowerState({
      avgRgba: [41.31, 42.67, 46.6, 255],
      region: { left: 48, top: 462, right: 312, bottom: 726 },
    }).state,
    "off",
  );

  assert.strictEqual(
    classifyPowerState({
      avgRgba: [62.29, 105.23, 144.81, 255],
      region: { left: 48, top: 462, right: 312, bottom: 726 },
    }).state,
    "on",
  );
});

test("shouldRetryPowerToggle waits for a stable unchanged tail before retrying", () => {
  assert.strictEqual(shouldRetryPowerToggle("off", ["off", "off", "off"]), false);
  assert.strictEqual(shouldRetryPowerToggle("off", ["off", "off", "off", "off"]), true);
  assert.strictEqual(shouldRetryPowerToggle("off", ["off", "off", "off", "on"]), false);
});

test("runCyclingSettingSkill opens the selector and verifies the requested mode", async () => {
  const commandCalls = [];
  const snapshotResponses = [
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(MODE_DIALOG_XML),
    buildSnapshotResult(HOME_HEAT_XML),
  ];
  const logLines = [];
  const originalLog = console.log;

  setAirTouchHomeControlsDepsForTest({
    runClawperatorCommand: (command, args) => {
      commandCalls.push({ command, args });
      if (command === "snapshot") {
        return { ok: true, result: snapshotResponses.shift() };
      }
      return { ok: true, result: buildJsonResult() };
    },
    sleep: async () => {},
  });
  console.log = (...args) => {
    logLines.push(args.join(" "));
  };

  try {
    const exitCode = await runCyclingSettingSkill({
      skillId: "au.com.polyaire.airtouch5.set-mode",
      goalKind: "set_mode",
      inputKey: "mode",
      requestedValue: "heat",
      allowedValues: ["cool", "heat", "fan", "dry", "auto"],
      deviceId: "<device_serial>",
    });

    const skillResult = captureSkillResult(logLines);
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(skillResult.status, "success");
    assert.strictEqual(skillResult.terminalVerification.status, "verified");
    assert.strictEqual(skillResult.diagnostics.finalValue, "heat");
    assert.deepStrictEqual(
      skillResult.checkpoints.map((checkpoint) => checkpoint.id),
      ["app_opened", "home_screen_ready", "current_value_read", "action_applied", "terminal_state_verified"],
    );
    assert.strictEqual(commandCalls.filter((call) => call.command === "click").length, 2);
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runCyclingSettingSkill downgrades runtimeState when the Home controls never expose live values", async () => {
  const logLines = [];
  const originalLog = console.log;

  setAirTouchHomeControlsDepsForTest({
    runClawperatorCommand: (command) => {
      if (command === "snapshot") {
        return { ok: true, result: buildSnapshotResult(HOME_OFF_XML) };
      }
      return { ok: true, result: buildJsonResult() };
    },
    sleep: async () => {},
  });
  console.log = (...args) => {
    logLines.push(args.join(" "));
  };

  try {
    const exitCode = await runCyclingSettingSkill({
      skillId: "au.com.polyaire.airtouch5.set-mode",
      goalKind: "set_mode",
      inputKey: "mode",
      requestedValue: "heat",
      allowedValues: ["cool", "heat", "fan", "dry", "auto"],
      deviceId: "<device_serial>",
    });

    const skillResult = captureSkillResult(logLines);
    assert.strictEqual(exitCode, 1);
    assert.strictEqual(skillResult.status, "failed");
    assert.strictEqual(skillResult.diagnostics.runtimeState, "unknown");
    assert.strictEqual(skillResult.checkpoints.at(-1).id, "home_controls_visible");
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runPowerStateSkill retries only after a stable unchanged observation window", async () => {
  const commandCalls = [];
  const snapshotResponses = [
    buildSnapshotResult(HOME_OFF_XML),
    buildSnapshotResult(HOME_OFF_XML),
    buildSnapshotResult(HOME_OFF_XML),
    buildSnapshotResult(HOME_OFF_XML),
    buildSnapshotResult(HOME_OFF_XML),
    buildSnapshotResult(HOME_XML),
  ];
  const classifiedStates = ["off", "off", "off", "off", "off", "on"];
  const logLines = [];
  const originalLog = console.log;

  setAirTouchHomeControlsDepsForTest({
    averageRgba: (_, bounds) => ({ avgRgba: [0, 0, 0, 255], region: bounds }),
    classifyPowerState: () => {
      const state = classifiedStates.shift();
      return {
        state,
        metrics: { brightness: state === "on" ? 100 : 40, blueDominance: state === "on" ? 60 : 4 },
      };
    },
    mkdtemp: async () => "/tmp/clawperator-airtouch-test",
    readPngRgba: async () => ({ width: 1, height: 1, rgba: Buffer.alloc(4) }),
    rm: async () => {},
    runClawperatorCommand: (command, args) => {
      commandCalls.push({ command, args });
      if (command === "snapshot") {
        return { ok: true, result: snapshotResponses.shift() };
      }
      return { ok: true, result: buildJsonResult() };
    },
    sleep: async () => {},
  });
  console.log = (...args) => {
    logLines.push(args.join(" "));
  };

  try {
    const exitCode = await runPowerStateSkill({
      skillId: "au.com.polyaire.airtouch5.set-power-state",
      requestedState: "on",
      deviceId: "<device_serial>",
    });

    const skillResult = captureSkillResult(logLines);
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(skillResult.status, "success");
    assert.strictEqual(skillResult.diagnostics.finalState, "on");
    assert.deepStrictEqual(skillResult.diagnostics.firstTapObservations, ["off", "off", "off", "off"]);
    assert.deepStrictEqual(skillResult.diagnostics.secondTapObservations, ["on"]);
    assert.strictEqual(commandCalls.filter((call) => call.command === "click").length, 2);
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});
