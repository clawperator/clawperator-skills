const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractChoiceDialogState,
  extractHomeScreenState,
  parseChoiceArg,
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

test("parseChoiceArg prefers an explicit named flag over positional fallbacks", () => {
  assert.strictEqual(
    parseChoiceArg(["--mode", "heat", "cool"], { flag: "--mode", allowedValues: ["cool", "heat", "fan", "dry", "auto"] }),
    "heat",
  );
});

test("parseChoiceArg skips values that belong to other named flags when using positional fallback", () => {
  assert.strictEqual(
    parseChoiceArg(["--device", "R5CT22AGEEF", "medium"], { flag: "--fan-level", allowedValues: ["auto", "low", "medium", "high"] }),
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

test("extractChoiceDialogState reads clickable option labels from the AirTouch selector dialog", () => {
  const dialog = extractChoiceDialogState(MODE_DIALOG_XML, ["cool", "heat", "fan", "dry", "auto"]);

  assert.ok(dialog);
  assert.deepStrictEqual(dialog.options.map((option) => option.normalized), ["cool", "auto", "heat", "dry", "fan"]);
});
