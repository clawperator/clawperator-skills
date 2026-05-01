const test = require("node:test");
const assert = require("node:assert/strict");

const {
  classifyPowerState,
  extractChoiceDialogState,
  extractHomeScreenState,
  mergePowerStateEvidence,
  parseChoiceArg,
  parseHomeControlsArgs,
  runCyclingSettingSkill,
  runHomeControlsSkill,
  runPowerStateSkill,
  splitDeviceAndArgs,
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

const NON_HOME_NAV_XML = [
  "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
  "<hierarchy rotation=\"0\">",
  "  <node index=\"0\" text=\"\" resource-id=\"root\" class=\"android.view.View\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,0][1080,2340]\">",
  "    <node index=\"1\" text=\"Settings\" resource-id=\"settings-root\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" bounds=\"[48,160][300,232]\" />",
  "    <node index=\"2\" text=\"Home\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,2052][216,2220]\" />",
  "    <node index=\"3\" text=\"Zones\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[216,2052][432,2220]\" />",
  "    <node index=\"4\" text=\"Timer\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[432,2052][648,2220]\" />",
  "    <node index=\"5\" text=\"Programs\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[648,2052][864,2220]\" />",
  "    <node index=\"6\" text=\"Insights\" resource-id=\"\" class=\"android.widget.Button\" package=\"au.com.polyaire.airtouch5\" bounds=\"[864,2052][1080,2220]\" />",
  "  </node>",
  "</hierarchy>",
].join("\n");

const HOME_HEAT_XML = HOME_XML.replace('text="Cool"', 'text="Heat"');
const HOME_HIGH_XML = HOME_XML.replace('text="Low"', 'text="High"');
const HOME_HEAT_HIGH_XML = HOME_HEAT_XML.replace('text="Low"', 'text="High"');

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

const FAN_DIALOG_XML = [
  "<?xml version='1.0' encoding='UTF-8' standalone='yes' ?>",
  "<hierarchy rotation=\"0\">",
  "  <node index=\"0\" text=\"\" resource-id=\"\" class=\"android.view.View\" package=\"au.com.polyaire.airtouch5\" bounds=\"[0,0][1080,2340]\">",
  "    <node index=\"1\" text=\"\" resource-id=\"\" class=\"android.app.AlertDialog\" package=\"au.com.polyaire.airtouch5\" bounds=\"[180,810][900,1530]\">",
  "      <node index=\"0\" text=\"Fan\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" clickable=\"false\" bounds=\"[498,870][582,942]\" />",
  "      <node index=\"1\" text=\"Auto\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" clickable=\"true\" bounds=\"[498,954][582,1026]\" />",
  "      <node index=\"2\" text=\"Low\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" clickable=\"true\" bounds=\"[498,1050][582,1122]\" />",
  "      <node index=\"3\" text=\"Medium\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" clickable=\"true\" bounds=\"[462,1146][618,1218]\" />",
  "      <node index=\"4\" text=\"High\" resource-id=\"\" class=\"android.widget.TextView\" package=\"au.com.polyaire.airtouch5\" clickable=\"true\" bounds=\"[498,1242][582,1314]\" />",
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

function buildPowerStateCommandCapture({ deviceId = "", requestedState = "off" } = {}) {
  const commandCalls = [];
  const logLines = [];
  const originalLog = console.log;

  setAirTouchHomeControlsDepsForTest({
    averageRgba: (_, bounds) => ({ avgRgba: [0, 0, 0, 255], region: bounds }),
    classifyPowerState: () => ({
      state: "off",
      metrics: { brightness: 40, blueDominance: 4 },
    }),
    mkdtemp: async () => "/tmp/clawperator-airtouch-power-test",
    readPngRgba: async () => ({ width: 1, height: 1, rgba: Buffer.alloc(4) }),
    rm: async () => {},
    runClawperatorCommand: (command, args) => {
      commandCalls.push({ command, args });
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

  return {
    async run() {
      try {
        const exitCode = await runPowerStateSkill({
          skillId: "au.com.polyaire.airtouch5.set-power-state",
          requestedState,
          deviceId,
        });
        const skillResult = captureSkillResult(logLines);
        return { exitCode, skillResult, commandCalls };
      } finally {
        console.log = originalLog;
        setAirTouchHomeControlsDepsForTest(null);
      }
    },
  };
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

test("splitDeviceAndArgs keeps a leading flag as skill input instead of a device id", () => {
  assert.deepStrictEqual(
    splitDeviceAndArgs(["--state", "off"]),
    {
      deviceId: "",
      rawArgs: ["--state", "off"],
    },
  );
});

test("splitDeviceAndArgs preserves an explicit device from the wrapper env", () => {
  assert.deepStrictEqual(
    splitDeviceAndArgs(["emulator-5554", "--state", "off"], "emulator-5554"),
    {
      deviceId: "emulator-5554",
      rawArgs: ["--state", "off"],
    },
  );
});

test("splitDeviceAndArgs strips an explicit positional device from the forwarded args", () => {
  assert.deepStrictEqual(
    splitDeviceAndArgs(["emulator-5554", "--state", "off"]),
    {
      deviceId: "emulator-5554",
      rawArgs: ["--state", "off"],
    },
  );
});

test("parseHomeControlsArgs accepts canonical optional Home controls", () => {
  assert.deepStrictEqual(
    parseHomeControlsArgs(["--state", "on", "--fan-level=high", "--mode", "cool"]),
    {
      request: { state: "on", fanLevel: "high", mode: "cool" },
      errors: [],
    },
  );
});

test("parseHomeControlsArgs rejects empty and contradictory Home control requests", () => {
  assert.deepStrictEqual(parseHomeControlsArgs([]).errors, ["Pass at least one of --state, --fan-level, or --mode."]);
  assert.deepStrictEqual(
    parseHomeControlsArgs(["--state", "off", "--fan-level", "low"]).errors,
    ["Do not combine --state off with --fan-level or --mode; Home controls are not adjustable while power is off."],
  );
  assert.deepStrictEqual(
    parseHomeControlsArgs(["--mode", "dry", "--fan-level", "medium"]).errors,
    ["Do not combine --mode dry with --fan-level; AirTouch does not expose a fan level to verify in Dry mode."],
  );
});

test("parseHomeControlsArgs rejects unknown and duplicate inputs", () => {
  assert.deepStrictEqual(
    parseHomeControlsArgs(["--state", "on", "--fan", "high"]).errors,
    ["Unknown argument --fan."],
  );
  assert.deepStrictEqual(
    parseHomeControlsArgs(["--state", "on", "high"]).errors,
    ["Unknown argument high."],
  );
  assert.deepStrictEqual(
    parseHomeControlsArgs(["--mode", "cool", "--mode", "dry", "--fan-level", "high"]).errors,
    ["Pass --mode only once."],
  );
  assert.deepStrictEqual(
    parseHomeControlsArgs(["--mode=fan", "--mode=dry"]).errors,
    ["Pass --mode only once."],
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

test("extractHomeScreenState does not treat a non-Home screen with bottom nav as Home", () => {
  const state = extractHomeScreenState(NON_HOME_NAV_XML);

  assert.strictEqual(state.isHomeScreen, false);
  assert.strictEqual(state.looksPoweredOn, false);
  assert.strictEqual(state.modeValue, null);
  assert.strictEqual(state.fanLevelValue, null);
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

  assert.strictEqual(
    classifyPowerState({
      avgRgba: [89.83, 121.61, 54.3, 255],
      region: { left: 48, top: 462, right: 312, bottom: 726 },
    }).state,
    "on",
  );
});

test("mergePowerStateEvidence keeps Home control values diagnostic only", () => {
  const state = mergePowerStateEvidence(
    {
      setPointVisible: false,
      modeValue: "fan",
      fanLevelValue: "medium",
    },
    {
      state: "off",
      metrics: {
        brightness: 88.58,
        blueDominance: -51.42,
        greenLift: 31.78,
        avgRgba: [89.83, 121.61, 54.3, 255],
      },
    },
  );

  assert.strictEqual(state.state, "off");
  assert.strictEqual(state.metrics.visualState, "off");
  assert.strictEqual(state.metrics.resolvedBy, "screenshot_crop");
  assert.deepStrictEqual(state.metrics.semanticSignals, {
    setPointVisible: false,
    modeValue: "fan",
    fanLevelValue: "medium",
  });
});

test("mergePowerStateEvidence falls back to screenshot crop when Home controls have no live values", () => {
  const state = mergePowerStateEvidence(
    {
      setPointVisible: false,
      modeValue: null,
      fanLevelValue: null,
    },
    {
      state: "off",
      metrics: { brightness: 40 },
    },
  );

  assert.strictEqual(state.state, "off");
  assert.strictEqual(state.metrics.resolvedBy, "screenshot_crop");
});

test("shouldRetryPowerToggle never retries toggle controls", () => {
  assert.strictEqual(shouldRetryPowerToggle("off", ["off", "off", "off"]), false);
  assert.strictEqual(shouldRetryPowerToggle("off", ["off", "off", "off", "off"]), false);
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
    averageRgba: (_, bounds) => ({ avgRgba: [0, 0, 0, 255], region: bounds }),
    classifyPowerState: () => ({
      state: "on",
      metrics: { brightness: 100, blueDominance: 60 },
    }),
    mkdtemp: async () => "/tmp/clawperator-airtouch-cycling-test",
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
      ["app_opened", "home_screen_ready", "power_current_value_read", "current_value_read", "mutation_started", "action_applied", "terminal_state_verified"],
    );
    assert.strictEqual(commandCalls.filter((call) => call.command === "click").length, 2);
    for (const call of commandCalls) {
      assert.ok(call.args.includes("--timeout"), `${call.command} should carry a Clawperator command timeout`);
      assert.ok(!call.args.includes("--no-daemon"), `${call.command} should use Clawperator's normal serialized device route`);
    }
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runCyclingSettingSkill retries a failed selector-opening click after observing Home", async () => {
  const commandCalls = [];
  const snapshotResponses = [
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(MODE_DIALOG_XML),
    buildSnapshotResult(HOME_HEAT_XML),
  ];
  const logLines = [];
  const originalLog = console.log;

  setAirTouchHomeControlsDepsForTest({
    averageRgba: (_, bounds) => ({ avgRgba: [0, 0, 0, 255], region: bounds }),
    classifyPowerState: () => ({
      state: "on",
      metrics: { brightness: 100, blueDominance: 60 },
    }),
    mkdtemp: async () => "/tmp/clawperator-airtouch-cycling-test",
    readPngRgba: async () => ({ width: 1, height: 1, rgba: Buffer.alloc(4) }),
    rm: async () => {},
    runClawperatorCommand: (command, args) => {
      commandCalls.push({ command, args });
      if (command === "snapshot") {
        return { ok: true, result: snapshotResponses.shift() };
      }
      if (command === "click" && commandCalls.filter((call) => call.command === "click").length === 1) {
        return { ok: false, error: "Command failed: click timed out" };
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
    assert.strictEqual(commandCalls.filter((call) => call.command === "click").length, 3);
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runCyclingSettingSkill retries a failed selector option click when the dialog stays open", async () => {
  const commandCalls = [];
  const snapshotResponses = [
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(MODE_DIALOG_XML),
    buildSnapshotResult(MODE_DIALOG_XML),
    buildSnapshotResult(MODE_DIALOG_XML),
    buildSnapshotResult(MODE_DIALOG_XML),
    buildSnapshotResult(HOME_HEAT_XML),
  ];
  const logLines = [];
  const originalLog = console.log;

  setAirTouchHomeControlsDepsForTest({
    averageRgba: (_, bounds) => ({ avgRgba: [0, 0, 0, 255], region: bounds }),
    classifyPowerState: () => ({
      state: "on",
      metrics: { brightness: 100, blueDominance: 60 },
    }),
    mkdtemp: async () => "/tmp/clawperator-airtouch-cycling-test",
    readPngRgba: async () => ({ width: 1, height: 1, rgba: Buffer.alloc(4) }),
    rm: async () => {},
    runClawperatorCommand: (command, args) => {
      commandCalls.push({ command, args });
      if (command === "snapshot") {
        return { ok: true, result: snapshotResponses.shift() };
      }
      if (command === "click" && commandCalls.filter((call) => call.command === "click").length === 2) {
        return { ok: false, error: "Command failed: click timed out" };
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
    assert.strictEqual(commandCalls.filter((call) => call.command === "click").length, 3);
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runCyclingSettingSkill rechecks visual power before terminal success", async () => {
  const snapshotResponses = [
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(MODE_DIALOG_XML),
    buildSnapshotResult(HOME_HEAT_XML),
  ];
  const classifiedStates = ["on", "off"];
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
    mkdtemp: async () => "/tmp/clawperator-airtouch-cycling-test",
    readPngRgba: async () => ({ width: 1, height: 1, rgba: Buffer.alloc(4) }),
    rm: async () => {},
    runClawperatorCommand: (command) => {
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
    assert.strictEqual(exitCode, 1);
    assert.strictEqual(skillResult.status, "failed");
    assert.deepStrictEqual(skillResult.terminalVerification.expected.value, { mode: "heat", state: "on" });
    assert.deepStrictEqual(skillResult.terminalVerification.observed.value, { mode: "heat", state: "off" });
    assert.match(skillResult.terminalVerification.note, /power off/);
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runHomeControlsSkill opens AirTouch once, turns power on first, and verifies fan level", async () => {
  const commandCalls = [];
  const snapshotResponses = [
    buildSnapshotResult(HOME_OFF_XML),
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(FAN_DIALOG_XML),
    buildSnapshotResult(HOME_HIGH_XML),
    buildSnapshotResult(HOME_HIGH_XML),
  ];
  const classifiedStates = ["off", "on", "on"];
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
    mkdtemp: async () => "/tmp/clawperator-airtouch-home-controls-test",
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
    const exitCode = await runHomeControlsSkill({
      skillId: "au.com.polyaire.airtouch5.set-home-controls",
      request: { state: "on", fanLevel: "high", mode: null },
      parseErrors: [],
      deviceId: "<device_serial>",
    });

    const skillResult = captureSkillResult(logLines);
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(skillResult.status, "success");
    assert.deepStrictEqual(skillResult.result.value.requested, { state: "on", fan_level: "high" });
    assert.deepStrictEqual(skillResult.result.value.final, { state: "on", fan_level: "high" });
    assert.strictEqual(skillResult.terminalVerification.status, "verified");
    assert.deepStrictEqual(
      skillResult.checkpoints.map((checkpoint) => checkpoint.id),
      [
        "app_opened",
        "home_screen_ready",
        "power_current_value_read",
        "power_mutation_started",
        "power_action_applied",
        "home_controls_visible",
        "fan_level_current_value_read",
        "fan_level_mutation_started",
        "fan_level_action_applied",
        "terminal_state_verified",
      ],
    );
    assert.strictEqual(commandCalls.filter((call) => call.command === "open").length, 1);
    assert.strictEqual(commandCalls.filter((call) => call.command === "click").length, 3);
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runHomeControlsSkill rechecks visual power in the final terminal state", async () => {
  const snapshotResponses = [
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(MODE_DIALOG_XML),
    buildSnapshotResult(HOME_HEAT_XML),
    buildSnapshotResult(HOME_HEAT_XML),
  ];
  const classifiedStates = ["on", "off"];
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
    mkdtemp: async () => "/tmp/clawperator-airtouch-home-controls-test",
    readPngRgba: async () => ({ width: 1, height: 1, rgba: Buffer.alloc(4) }),
    rm: async () => {},
    runClawperatorCommand: (command) => {
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
    const exitCode = await runHomeControlsSkill({
      skillId: "au.com.polyaire.airtouch5.set-home-controls",
      request: { state: "on", fanLevel: null, mode: "heat" },
      parseErrors: [],
      deviceId: "<device_serial>",
    });

    const skillResult = captureSkillResult(logLines);
    assert.strictEqual(exitCode, 1);
    assert.strictEqual(skillResult.status, "failed");
    assert.deepStrictEqual(skillResult.terminalVerification.expected.value, { state: "on", mode: "heat" });
    assert.deepStrictEqual(skillResult.terminalVerification.observed.value, { state: "off", mode: "heat" });
    assert.match(skillResult.terminalVerification.note, /state expected on but observed off/);
    assert.deepStrictEqual(skillResult.diagnostics.finalValues, { state: "off", mode: "heat" });
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runHomeControlsSkill retries transient final power screenshots", async () => {
  const snapshotResponses = [
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(MODE_DIALOG_XML),
    buildSnapshotResult(HOME_HEAT_XML),
    buildSnapshotResult(HOME_HEAT_XML),
  ];
  const classifiedStates = ["on", "on"];
  const logLines = [];
  const originalLog = console.log;
  let finalScreenshotFailures = 0;

  setAirTouchHomeControlsDepsForTest({
    averageRgba: (_, bounds) => ({ avgRgba: [0, 0, 0, 255], region: bounds }),
    classifyPowerState: () => {
      const state = classifiedStates.shift();
      return {
        state,
        metrics: { brightness: state === "on" ? 100 : 40, blueDominance: state === "on" ? 60 : 4 },
      };
    },
    mkdtemp: async () => "/tmp/clawperator-airtouch-home-controls-test",
    readPngRgba: async () => ({ width: 1, height: 1, rgba: Buffer.alloc(4) }),
    rm: async () => {},
    runClawperatorCommand: (command, args) => {
      if (command === "snapshot") {
        return { ok: true, result: snapshotResponses.shift() };
      }
      if (command === "screenshot") {
        const screenshotPath = args[args.indexOf("--path") + 1];
        if (screenshotPath.includes("power-final") && finalScreenshotFailures < 4) {
          finalScreenshotFailures += 1;
          return { ok: false, error: "RESULT_ENVELOPE_TIMEOUT" };
        }
      }
      return { ok: true, result: buildJsonResult() };
    },
    sleep: async () => {},
  });
  console.log = (...args) => {
    logLines.push(args.join(" "));
  };

  try {
    const exitCode = await runHomeControlsSkill({
      skillId: "au.com.polyaire.airtouch5.set-home-controls",
      request: { state: "on", fanLevel: null, mode: "heat" },
      parseErrors: [],
      deviceId: "<device_serial>",
    });

    const skillResult = captureSkillResult(logLines);
    assert.strictEqual(exitCode, 0);
    assert.strictEqual(skillResult.status, "success");
    assert.deepStrictEqual(skillResult.result.value.final, { state: "on", mode: "heat" });
    assert.strictEqual(skillResult.diagnostics.finalPowerMetrics.screenshotAttempts, 5);
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runHomeControlsSkill verifies mode and fan from one final Home snapshot", async () => {
  const snapshotResponses = [
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(MODE_DIALOG_XML),
    buildSnapshotResult(HOME_HEAT_XML),
    buildSnapshotResult(FAN_DIALOG_XML),
    buildSnapshotResult(HOME_HEAT_HIGH_XML),
    buildSnapshotResult(HOME_HIGH_XML),
  ];
  const logLines = [];
  const originalLog = console.log;

  setAirTouchHomeControlsDepsForTest({
    averageRgba: (_, bounds) => ({ avgRgba: [0, 0, 0, 255], region: bounds }),
    classifyPowerState: () => ({
      state: "on",
      metrics: { brightness: 100, blueDominance: 60 },
    }),
    mkdtemp: async () => "/tmp/clawperator-airtouch-home-controls-test",
    readPngRgba: async () => ({ width: 1, height: 1, rgba: Buffer.alloc(4) }),
    rm: async () => {},
    runClawperatorCommand: (command) => {
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
    const exitCode = await runHomeControlsSkill({
      skillId: "au.com.polyaire.airtouch5.set-home-controls",
      request: { state: null, fanLevel: "high", mode: "heat" },
      parseErrors: [],
      deviceId: "<device_serial>",
    });

    const skillResult = captureSkillResult(logLines);
    assert.strictEqual(exitCode, 1);
    assert.strictEqual(skillResult.status, "failed");
    assert.deepStrictEqual(skillResult.terminalVerification.expected.value, { mode: "heat", fan_level: "high", state: "on" });
    assert.deepStrictEqual(skillResult.terminalVerification.observed.value, { mode: "cool", fan_level: "high", state: "on" });
    assert.match(skillResult.terminalVerification.note, /mode expected heat but observed cool/);
    assert.deepStrictEqual(skillResult.diagnostics.finalValues, { mode: "cool", fan_level: "high", state: "on" });
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runHomeControlsSkill rechecks visual power for mode and fan terminal verification", async () => {
  const snapshotResponses = [
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(MODE_DIALOG_XML),
    buildSnapshotResult(HOME_HEAT_XML),
    buildSnapshotResult(FAN_DIALOG_XML),
    buildSnapshotResult(HOME_HEAT_HIGH_XML),
    buildSnapshotResult(HOME_HEAT_HIGH_XML),
  ];
  const classifiedStates = ["on", "off"];
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
    mkdtemp: async () => "/tmp/clawperator-airtouch-home-controls-test",
    readPngRgba: async () => ({ width: 1, height: 1, rgba: Buffer.alloc(4) }),
    rm: async () => {},
    runClawperatorCommand: (command) => {
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
    const exitCode = await runHomeControlsSkill({
      skillId: "au.com.polyaire.airtouch5.set-home-controls",
      request: { state: null, fanLevel: "high", mode: "heat" },
      parseErrors: [],
      deviceId: "<device_serial>",
    });

    const skillResult = captureSkillResult(logLines);
    assert.strictEqual(exitCode, 1);
    assert.strictEqual(skillResult.status, "failed");
    assert.deepStrictEqual(skillResult.terminalVerification.expected.value, { mode: "heat", fan_level: "high", state: "on" });
    assert.deepStrictEqual(skillResult.terminalVerification.observed.value, { mode: "heat", fan_level: "high", state: "off" });
    assert.match(skillResult.terminalVerification.note, /state expected on but observed off/);
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runHomeControlsSkill rejects stale mode and fan labels when visual power is off", async () => {
  const commandCalls = [];
  const snapshotResponses = [
    buildSnapshotResult(HOME_XML),
  ];
  const logLines = [];
  const originalLog = console.log;

  setAirTouchHomeControlsDepsForTest({
    averageRgba: (_, bounds) => ({ avgRgba: [0, 0, 0, 255], region: bounds }),
    classifyPowerState: () => ({
      state: "off",
      metrics: { brightness: 40, blueDominance: 4 },
    }),
    mkdtemp: async () => "/tmp/clawperator-airtouch-home-controls-test",
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
    const exitCode = await runHomeControlsSkill({
      skillId: "au.com.polyaire.airtouch5.set-home-controls",
      request: { state: null, fanLevel: "low", mode: "cool" },
      parseErrors: [],
      deviceId: "<device_serial>",
    });

    const skillResult = captureSkillResult(logLines);
    assert.strictEqual(exitCode, 1);
    assert.strictEqual(skillResult.status, "failed");
    assert.strictEqual(skillResult.checkpoints.at(-1).id, "home_controls_visible");
    assert.match(skillResult.checkpoints.at(-1).note, /not trusted because power did not look on/);
    assert.strictEqual(commandCalls.filter((call) => call.command === "click").length, 0);
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runCyclingSettingSkill downgrades runtimeState when the Home controls never expose live values", async () => {
  const logLines = [];
  const originalLog = console.log;

  setAirTouchHomeControlsDepsForTest({
    averageRgba: (_, bounds) => ({ avgRgba: [0, 0, 0, 255], region: bounds }),
    classifyPowerState: () => ({
      state: "off",
      metrics: { brightness: 40, blueDominance: 4 },
    }),
    mkdtemp: async () => "/tmp/clawperator-airtouch-cycling-test",
    readPngRgba: async () => ({ width: 1, height: 1, rgba: Buffer.alloc(4) }),
    rm: async () => {},
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

test("runPowerStateSkill does not retry a power toggle after unchanged observations", async () => {
  const commandCalls = [];
  const snapshotResponses = [
    buildSnapshotResult(HOME_OFF_XML),
    buildSnapshotResult(HOME_OFF_XML),
    buildSnapshotResult(HOME_OFF_XML),
    buildSnapshotResult(HOME_OFF_XML),
    buildSnapshotResult(HOME_OFF_XML),
  ];
  const classifiedStates = ["off", "off", "off", "off", "off"];
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
    assert.strictEqual(exitCode, 1);
    assert.strictEqual(skillResult.status, "failed");
    assert.deepStrictEqual(skillResult.diagnostics.firstTapObservations, ["off", "off", "off", "off"]);
    assert.strictEqual(skillResult.diagnostics.secondTapObservations, undefined);
    assert.strictEqual(skillResult.diagnostics.powerRetryPolicy, "single_tap_only");
    assert.strictEqual(commandCalls.filter((call) => call.command === "click").length, 1);
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runPowerStateSkill omits --device when no explicit device is available", async () => {
  const { run } = buildPowerStateCommandCapture({ deviceId: "" });
  const { exitCode, skillResult, commandCalls } = await run();

  assert.strictEqual(exitCode, 0);
  assert.strictEqual(skillResult.status, "success");
  assert.ok(commandCalls.length > 0);
  for (const call of commandCalls) {
    assert.ok(!call.args.includes("--device"), `${call.command} should let Clawperator resolve the device automatically`);
  }
});

test("runPowerStateSkill forwards an explicit device id from CLAWPERATOR_DEVICE_ID", async () => {
  const { deviceId } = splitDeviceAndArgs(["--state", "off"], "emulator-5554");
  const { run } = buildPowerStateCommandCapture({ deviceId });
  const { exitCode, skillResult, commandCalls } = await run();

  assert.strictEqual(exitCode, 0);
  assert.strictEqual(skillResult.status, "success");
  for (const call of commandCalls) {
    assert.ok(call.args.includes("--device"), `${call.command} should forward the explicit device id`);
    assert.ok(call.args.includes("emulator-5554"), `${call.command} should forward the explicit device serial`);
  }
});

test("runPowerStateSkill forwards an explicit positional device id", async () => {
  const { deviceId } = splitDeviceAndArgs(["emulator-5554", "--state", "off"]);
  const { run } = buildPowerStateCommandCapture({ deviceId });
  const { exitCode, skillResult, commandCalls } = await run();

  assert.strictEqual(exitCode, 0);
  assert.strictEqual(skillResult.status, "success");
  for (const call of commandCalls) {
    assert.ok(call.args.includes("--device"), `${call.command} should forward the positional device id`);
    assert.ok(call.args.includes("emulator-5554"), `${call.command} should forward the positional device serial`);
  }
});

test("runCyclingSettingSkill retries a transient snapshot failure after choosing an option", async () => {
  const commandCalls = [];
  const snapshotResponses = [
    buildSnapshotResult(HOME_XML),
    buildSnapshotResult(MODE_DIALOG_XML),
    buildSnapshotResult(HOME_HEAT_XML),
  ];
  const logLines = [];
  const originalLog = console.log;
  let failedFinalSnapshot = false;

  setAirTouchHomeControlsDepsForTest({
    averageRgba: (_, bounds) => ({ avgRgba: [0, 0, 0, 255], region: bounds }),
    classifyPowerState: () => ({
      state: "on",
      metrics: { brightness: 100, blueDominance: 60 },
    }),
    mkdtemp: async () => "/tmp/clawperator-airtouch-cycling-test",
    readPngRgba: async () => ({ width: 1, height: 1, rgba: Buffer.alloc(4) }),
    rm: async () => {},
    runClawperatorCommand: (command, args) => {
      commandCalls.push({ command, args });
      if (command === "snapshot") {
        if (commandCalls.filter((call) => call.command === "click").length >= 2 && !failedFinalSnapshot) {
          failedFinalSnapshot = true;
          return { ok: false, error: "RESULT_ENVELOPE_TIMEOUT" };
        }
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
    assert.strictEqual(skillResult.diagnostics.finalValue, "heat");
    assert.strictEqual(failedFinalSnapshot, true);
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});

test("runPowerStateSkill retries a transient screenshot failure during power verification", async () => {
  const commandCalls = [];
  const snapshotResponses = [
    buildSnapshotResult(HOME_OFF_XML),
    buildSnapshotResult(HOME_XML),
  ];
  const classifiedStates = ["off", "on"];
  const logLines = [];
  const originalLog = console.log;
  let failedAfterScreenshot = false;

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
      if (command === "screenshot") {
        const screenshotPath = args[args.indexOf("--path") + 1];
        if (screenshotPath.endsWith("power-after-1-1.png") && !failedAfterScreenshot) {
          failedAfterScreenshot = true;
          return { ok: false, error: "RESULT_ENVELOPE_TIMEOUT" };
        }
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
    assert.strictEqual(skillResult.diagnostics.lastPowerMetrics.screenshotAttempts, 2);
    assert.strictEqual(commandCalls.filter((call) => call.command === "click").length, 1);
  } finally {
    console.log = originalLog;
    setAirTouchHomeControlsDepsForTest(null);
  }
});
