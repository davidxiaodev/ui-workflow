#!/usr/bin/env node
// Screenshots of a React Native / Expo app on simulators and emulators, compared with baselines.
// The mobile counterpart of the web look check (Playwright toHaveScreenshot).
//
//   node rn-look.mjs [--config e2e/rn-look/screens.json] [--platform ios|android] [--update]
//                    [--dry-run] [--compare-only] [--out <dir>]
//
// For each device and variant (default, dark, large-text) it fixes the status bar, sets the
// appearance and text size, opens every screen by deep link with one Maestro flow, takes a
// screenshot, and compares it with e2e/rn-look/look-snapshots/<screen>-<variant>-<platform>-<width>.png.
// Screenshots, diff images and report.md go to $VERIFY_RUN_DIR/rn-look/<group>/ (or test-results/rn-look).
//
//   --update        accept the new screenshots as baselines (review them first; a baseline change is merge tier 2)
//   --dry-run       print the commands and files it would use, run nothing
//   --compare-only  skip capturing; compare screenshots already in the output folder
//
// Exit 0 = every screen matches, 1 = differences or missing baselines, 2 = setup error.
// Needs: maestro on PATH; for iOS, Xcode (xcrun simctl); for Android, adb with the emulator running.
// The app must already be installed on the devices (a development build; `install` in the config
// runs a command per platform first).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { comparePng, decodePng, encodePng } from "./lib/png.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? undefined : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const configPath = resolve(opt("config") ?? "e2e/rn-look/screens.json");
if (!existsSync(configPath)) fail(`rn-look: no ${configPath}. Copy the plugin's skills/frontend/templates/rn-look.json there and fill it in.`);
const config = JSON.parse(readFileSync(configPath, "utf8"));
const baselines = resolve(config.baselines ?? "e2e/rn-look/look-snapshots"); // relative to where the check runs
const outDir = resolve(opt("out") ?? (process.env.VERIFY_RUN_DIR ? join(process.env.VERIFY_RUN_DIR, "rn-look") : "test-results/rn-look"));
const variants = config.variants ?? ["default", "dark", "large-text"];
const onlyPlatform = opt("platform");
const devices = (config.devices ?? []).filter((d) => !onlyPlatform || d.platform === onlyPlatform);
const dry = flag("dry-run");
const threshold = config.threshold ?? 16;
const maxDiffRatio = config.maxDiffRatio ?? 0.001;

for (const k of ["appId", "screens"]) if (!config[k]) fail(`rn-look: ${configPath} needs "${k}".`);
if (!devices.length) fail("rn-look: no devices (devices: [{ platform, name or serial, width }]).");
for (const d of devices) {
  if (!["ios", "android"].includes(d.platform)) fail(`rn-look: device platform must be ios or android, not ${d.platform}.`);
  if (!d.width) fail(`rn-look: device ${d.name ?? d.serial} needs "width" (the screen width in points or dp, used in file names).`);
}

const shots = [];
for (const device of devices) {
  for (const variant of variants) {
    for (const screen of config.screens) {
      const name = `${screen.name}-${variant}-${device.platform}-${device.width}`;
      shots.push({ device, variant, screen, name, file: join(outDir, screen.group ?? "screens", `${name}.png`), baseline: join(baselines, `${name}.png`) });
    }
  }
}

if (!flag("compare-only")) capture();
if (dry) {
  for (const s of shots) console.log(`would compare ${rel(s.file)} with ${rel(s.baseline)}`);
  process.exit(0);
}
process.exit(compare());

function capture() {
  const run = (cmd, argv, { ignoreFail = false } = {}) => {
    console.log(`$ ${[cmd, ...argv].map(q).join(" ")}`);
    if (dry) return "";
    const r = spawnSync(cmd, argv, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    if (r.error) fail(`rn-look: cannot run ${cmd} (${r.error.code}); is it installed and on PATH?`);
    if (r.status !== 0 && !ignoreFail) fail(`rn-look: ${cmd} ${argv.join(" ")} failed:\n${r.stderr || r.stdout}`);
    return r.stdout;
  };
  for (const platform of ["ios", "android"]) {
    if (config.install?.[platform] && devices.some((d) => d.platform === platform)) run("sh", ["-c", config.install[platform]]);
  }
  for (const device of devices) {
    const id = device.platform === "ios" ? iosDevice(device, run) : device.serial ?? "emulator-5554";
    statusBar(device.platform, id, run);
    for (const variant of variants) {
      setVariant(device.platform, id, variant, run);
      const mine = shots.filter((s) => s.device === device && s.variant === variant);
      for (const s of mine) mkdirSync(dirname(s.file), { recursive: true });
      const flow = join(outDir, "flows", `${device.platform}-${device.width}-${variant}.yaml`);
      mkdirSync(dirname(flow), { recursive: true });
      writeFileSync(flow, flowYaml(mine));
      run("maestro", ["--device", id, "test", flow]);
    }
    setVariant(device.platform, id, "default", run);
  }
}

function flowYaml(list) {
  const lines = [`appId: ${config.appId}`, "---", "- launchApp"];
  for (const s of list) {
    lines.push(`- openLink: ${JSON.stringify(s.screen.link)}`);
    if (s.screen.waitFor) lines.push("- extendedWaitUntil:", `    visible: ${JSON.stringify(s.screen.waitFor)}`, `    timeout: ${config.timeoutMs ?? 20000}`);
    lines.push("- waitForAnimationToEnd", `- takeScreenshot: ${JSON.stringify(s.file.replace(/\.png$/, ""))}`);
  }
  return lines.join("\n") + "\n";
}

function iosDevice(device, run) {
  if (device.udid) return device.udid;
  if (dry) return `<udid of ${device.name}>`;
  const list = JSON.parse(run("xcrun", ["simctl", "list", "devices", "available", "-j"]));
  const all = Object.values(list.devices).flat();
  const found = all.find((d) => d.name === device.name);
  if (!found) fail(`rn-look: no available simulator named "${device.name}". xcrun simctl list devices available`);
  run("xcrun", ["simctl", "boot", found.udid], { ignoreFail: true });
  run("xcrun", ["simctl", "bootstatus", found.udid, "-b"]);
  return found.udid;
}

function statusBar(platform, id, run) {
  if (platform === "ios") {
    run("xcrun", ["simctl", "status_bar", id, "override", "--time", "9:41", "--batteryState", "charged", "--batteryLevel", "100", "--wifiBars", "3", "--cellularBars", "4"]);
    return;
  }
  const demo = (...extra) => run("adb", ["-s", id, "shell", "am", "broadcast", "-a", "com.android.systemui.demo", ...extra]);
  run("adb", ["-s", id, "shell", "settings", "put", "global", "sysui_demo_allowed", "1"]);
  demo("-e", "command", "enter");
  demo("-e", "command", "clock", "-e", "hhmm", "0941");
  demo("-e", "command", "battery", "-e", "level", "100", "-e", "plugged", "false");
  demo("-e", "command", "network", "-e", "wifi", "show", "-e", "level", "4");
  demo("-e", "command", "notifications", "-e", "visible", "false");
}

function setVariant(platform, id, variant, run) {
  const dark = variant === "dark";
  const large = variant === "large-text";
  if (platform === "ios") {
    run("xcrun", ["simctl", "ui", id, "appearance", dark ? "dark" : "light"]);
    run("xcrun", ["simctl", "ui", id, "content_size", large ? "accessibility-extra-large" : "large"]);
  } else {
    run("adb", ["-s", id, "shell", "cmd", "uimode", "night", dark ? "yes" : "no"]);
    run("adb", ["-s", id, "shell", "settings", "put", "system", "font_scale", large ? "1.5" : "1.0"]);
  }
}

function compare() {
  const rows = [];
  let failed = 0;
  for (const s of shots) {
    if (!existsSync(s.file)) {
      rows.push({ s, result: "missing screenshot" });
      failed++;
      continue;
    }
    if (flag("update")) {
      mkdirSync(dirname(s.baseline), { recursive: true });
      copyFileSync(s.file, s.baseline);
      rows.push({ s, result: "baseline updated" });
      continue;
    }
    if (!existsSync(s.baseline)) {
      rows.push({ s, result: "no baseline (review the screenshot, then --update)" });
      failed++;
      continue;
    }
    const c = comparePng(decodePng(readFileSync(s.baseline)), decodePng(readFileSync(s.file)), { threshold, mask: s.screen.mask ?? [] });
    if (!c.sameSize) {
      rows.push({ s, result: "different size from the baseline" });
      failed++;
      continue;
    }
    const ok = c.ratio <= (s.screen.maxDiffRatio ?? maxDiffRatio);
    let diffFile = null;
    if (!ok) {
      diffFile = s.file.replace(/\.png$/, ".diff.png"); // not "<name>-<width>.png", so the evidence pack does not take it for a screen
      writeFileSync(diffFile, encodePng(c.diff));
      failed++;
    }
    rows.push({ s, result: ok ? "match" : `differs: ${(c.ratio * 100).toFixed(3)}% of pixels`, diffFile });
  }
  const report = [
    "# rn-look",
    "",
    "| Screen | Variant | Device | Result | Diff |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(({ s, result, diffFile }) => `| ${s.screen.name} | ${s.variant} | ${s.device.platform} ${s.device.name ?? s.device.serial ?? ""} (${s.device.width}) | ${result} | ${diffFile ? rel(diffFile) : ""} |`),
    "",
  ].join("\n");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.md"), report);
  for (const { s, result } of rows) if (result !== "match") console.log(`rn-look: ${s.name}: ${result}`);
  console.log(`rn-look: ${rows.length - failed}/${rows.length} match · ${rel(join(outDir, "report.md"))}`);
  return failed ? 1 : 0;
}

function rel(p) {
  return relative(process.cwd(), p) || p;
}

function q(s) {
  return /^[\w@%+=:,./-]+$/.test(s) ? s : `'${s.replace(/'/g, "'\\''")}'`;
}

function fail(message) {
  console.error(message);
  process.exit(2);
}

