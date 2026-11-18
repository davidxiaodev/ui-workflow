import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, describe, it } from "node:test";
import { deflateSync } from "node:zlib";
import { loadConfig } from "../plugins/dx-workflow/scripts/lib/verify-config.mjs";
import { comparePng, decodePng, encodePng } from "../plugins/dx-workflow/scripts/lib/png.mjs";
import { cleanup, evidenceText, makeProject, node, read, SCRIPTS, tierOf, verify, write } from "./helpers.mjs";

const roots = [];
const temps = [];
const project = (opts) => {
  const r = makeProject(opts);
  roots.push(r);
  return r;
};
const tmp = () => {
  const d = mkdtempSync(join(tmpdir(), "dxm-"));
  temps.push(d);
  return d;
};
after(() => {
  roots.forEach(cleanup);
  temps.forEach((d) => rmSync(d, { recursive: true, force: true }));
});

const RN = {
  lanes: {
    app: {
      kind: "frontend",
      platform: "react-native",
      checks: [
        { name: "unit", run: "node test/run.mjs" },
        { name: "look", run: "node -e process.exit(1)", ci: false },
        { name: "after", run: "node -e 0" },
      ],
    },
  },
};

function image(width, height, fill) {
  const data = Buffer.alloc(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(fill(i % width, Math.floor(i / width)), i * 4);
  return { width, height, data };
}

// A PNG with colour type 2 (RGB) and every scanline filter, to exercise the decoder beyond what encodePng writes.
function rgbPngWithFilters(img) {
  const { width, height, data } = img;
  const bpp = 3;
  const stride = width * bpp;
  const rows = [];
  for (let y = 0; y < height; y++) {
    const row = Buffer.alloc(stride);
    for (let x = 0; x < width; x++) for (let c = 0; c < 3; c++) row[x * 3 + c] = data[(y * width + x) * 4 + c];
    rows.push(row);
  }
  const out = [];
  for (let y = 0; y < height; y++) {
    const f = y % 5;
    const cur = rows[y];
    const prev = y ? rows[y - 1] : Buffer.alloc(stride);
    const line = Buffer.alloc(stride + 1);
    line[0] = f;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      const p = a + b - c;
      const pred = [0, a, b, (a + b) >> 1, Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c][f];
      line[x + 1] = (cur[x] - pred) & 255;
    }
    out.push(line);
  }
  const sig = encodePng({ width: 1, height: 1, data: Buffer.alloc(4) }).subarray(0, 8);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  const chunk = (kind, body) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(body.length);
    const head = Buffer.from(kind, "latin1");
    const crc = Buffer.alloc(4); // decodePng does not check CRCs
    return Buffer.concat([len, head, body, crc]);
  };
  return Buffer.concat([sig, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(out))), chunk("IEND", Buffer.alloc(0))]);
}

describe("png", () => {
  const img = image(23, 17, (x, y) => [(x * 11) & 255, (y * 15) & 255, (x * y) & 255, 255]);

  it("round-trips RGBA and decodes RGB with every filter", () => {
    assert.deepEqual(decodePng(encodePng(img)).data, img.data);
    assert.deepEqual(decodePng(rgbPngWithFilters(img)).data, img.data);
  });

  it("compares: identical, changed pixels, masked areas, size mismatch", () => {
    assert.equal(comparePng(img, img).ratio, 0);
    const changed = { ...img, data: Buffer.from(img.data) };
    for (let x = 0; x < 5; x++) changed.data.set([255, 255, 255, 255], x * 4); // 5 pixels in the top row
    const c = comparePng(img, changed);
    assert.equal(c.diffPixels, 5);
    assert.ok(c.ratio > 0.01);
    assert.equal(comparePng(img, changed, { mask: [[0, 0, 1, 0.1]] }).diffPixels, 0);
    assert.equal(comparePng(img, image(10, 10, () => [0, 0, 0, 255])).sameSize, false);
  });
});

describe("rn-look", () => {
  function setup() {
    const dir = tmp();
    mkdirSync(join(dir, "e2e/rn-look"), { recursive: true });
    const config = {
      appId: "com.example.app",
      devices: [{ platform: "ios", name: "iPhone SE (3rd generation)", width: 375 }],
      variants: ["default", "dark"],
      screens: [
        { name: "home", group: "tabs", link: "app://home", waitFor: "Home" },
        { name: "settings", group: "tabs", link: "app://settings", waitFor: "Settings", mask: [[0, 0, 1, 0.2]] },
      ],
    };
    writeFileSync(join(dir, "e2e/rn-look/screens.json"), JSON.stringify(config));
    const out = join(dir, "out");
    const shot = (name, img) => {
      mkdirSync(join(out, "tabs"), { recursive: true });
      writeFileSync(join(out, "tabs", `${name}.png`), encodePng(img));
    };
    const run = (...extra) => spawnSync(process.execPath, [join(SCRIPTS, "rn-look.mjs"), "--out", out, ...extra], { cwd: dir, encoding: "utf8" });
    return { dir, out, shot, run };
  }
  const base = image(20, 40, (x, y) => [x * 10, y * 5, 100, 255]);

  it("plans simulator setup and one Maestro flow per device and variant in a dry run", () => {
    const { run, out } = setup();
    const r = run("--dry-run");
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /xcrun simctl status_bar .* override --time 9:41/);
    assert.match(r.stdout, /xcrun simctl ui .* appearance dark/);
    assert.match(r.stdout, /maestro --device .* test .*ios-375-dark\.yaml/);
    assert.match(r.stdout, /would compare .*tabs\/home-dark-ios-375\.png with .*look-snapshots\/home-dark-ios-375\.png/);
    const flow = readFileSync(join(out, "flows", "ios-375-default.yaml"), "utf8");
    assert.match(flow, /appId: com\.example\.app\n---\n- launchApp\n- openLink: "app:\/\/home"/);
    assert.match(flow, /takeScreenshot: ".*tabs\/home-default-ios-375"/);
  });

  it("fails without baselines, accepts them with --update, then matches, flags a change, and honours masks", () => {
    const { dir, out, shot, run } = setup();
    for (const v of ["default", "dark"]) for (const s of ["home", "settings"]) shot(`${s}-${v}-ios-375`, base);
    let r = run("--compare-only");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /no baseline/);
    assert.equal(run("--compare-only", "--update").status, 0);
    assert.ok(existsSync(join(dir, "e2e/rn-look/look-snapshots/home-dark-ios-375.png")));
    assert.equal(run("--compare-only").status, 0);

    const moved = image(20, 40, (x, y) => (y < 4 ? [255, 255, 255, 255] : [x * 10, y * 5, 100, 255])); // top 10% changed
    shot("home-default-ios-375", moved);
    shot("settings-default-ios-375", moved); // inside the settings mask
    r = run("--compare-only");
    assert.equal(r.status, 1);
    assert.match(r.stdout, /home-default-ios-375: differs/);
    assert.doesNotMatch(r.stdout, /settings-default-ios-375/);
    assert.ok(existsSync(join(out, "tabs", "home-default-ios-375.diff.png")));
    assert.match(readFileSync(join(out, "report.md"), "utf8"), /\| home \| default \| ios iPhone SE \(3rd generation\) \(375\) \| differs/);
  });
});

describe("check-raw-styles --platform react-native", () => {
  it("flags colour props, font literals and off-scale spacing, and skips the theme file", () => {
    const dir = tmp();
    mkdirSync(join(dir, "src"));
    writeFileSync(
      join(dir, "src/Card.tsx"),
      [
        "const s = StyleSheet.create({",
        "  card: { backgroundColor: '#fff', padding: 13, margin: 16, borderColor: theme.colors.border },",
        "  title: { fontSize: 18, fontFamily: 'Inter-Bold', color: theme.colors.text },",
        "});",
        'export const C = () => <TextInput placeholderTextColor="gray" style={{ padding: theme.space[2] }} />;',
      ].join("\n"),
    );
    writeFileSync(join(dir, "src/theme.ts"), 'export const colors = { primary: "#0a7", text: "black" };\n');
    const r = spawnSync(process.execPath, [join(SCRIPTS, "check-raw-styles.mjs"), "src", "--platform", "react-native", "--spacing-scale", "0,4,8,12,16,24", "--json"], { cwd: dir, encoding: "utf8" });
    assert.equal(r.status, 1);
    const got = JSON.parse(r.stdout).findings.map((f) => `${f.rule} ${f.line} ${f.match}`);
    assert.deepEqual(got.sort(), [
      "off-scale-spacing 2 padding: 13",
      "rn-font-literal 3 fontFamily: 'Inter-Bold",
      "rn-font-literal 3 fontSize: 18",
      "rn-literal-colour 2 backgroundColor: '#fff",
      'rn-literal-colour 5 placeholderTextColor="gray',
    ]);
  });
});

describe("react-native lanes", () => {
  it("default to app code plus native config, and mark native paths", () => {
    const root = project({ config: { lanes: { app: { kind: "frontend", platform: "react-native", checks: [] }, web: { kind: "frontend", checks: [] } } } });
    const [app, web] = loadConfig(root).lanes;
    assert.equal(app.platform, "react-native");
    assert.ok(app.files.includes("**/*.{ts,tsx,js,jsx}") && app.files.includes("ios/**"));
    assert.ok(app.native.includes("app.json"));
    assert.equal(web.platform, "web");
    assert.deepEqual(web.native, []);
  });

  it("skip ci:false checks in CI without stopping the lane, and run them locally", () => {
    const root = project({ config: RN });
    write(root, { "src/math.mjs": read(root, "src/math.mjs") + "// x\n" });
    let r = node("run-verify.mjs", [], { cwd: root, env: { CI: "true" } });
    assert.equal(r.code, 0, r.stdout);
    const checks = JSON.parse(read(root, ".verify/last-run.json")).lanes.app.checks;
    assert.deepEqual(checks.map((c) => [c.name, c.skipped ?? false, c.exitCode]), [["unit", false, 0], ["look", true, null], ["after", false, 0]]);
    r = node("run-verify.mjs", [], { cwd: root });
    assert.equal(r.code, 1, "locally the look check runs (and fails here)");
  });

  const rnProject = (files = {}) =>
    project({
      config: { lanes: { app: { kind: "frontend", platform: "react-native", files: ["src/**", "test/**", "app.json", "package.json"], checks: [{ name: "unit", run: "node test/run.mjs" }] } } },
      files: { "app.json": '{ "expo": { "name": "a" } }\n', "package.json": '{\n  "dependencies": {\n    "react-native": "0.76.0"\n  }\n}\n', ...files },
    });

  it("tier 3 and a one-way door for app.json", () => {
    const root = rnProject();
    write(root, { "app.json": '{ "expo": { "name": "a", "scheme": "a" } }\n', "src/math.mjs": read(root, "src/math.mjs") + "// x\n" });
    verify(root, { lane: "app" });
    assert.equal(tierOf(root), "3");
    const ev = evidenceText(root);
    assert.match(ev, /a native change needs a new store build \(app\.json\)/);
    assert.match(ev, /- Door: one-way: a native change ships only in a new store build/);
  });

  it("tier 3 for a new native module, not for a JavaScript-only dependency", () => {
    const root = rnProject();
    write(root, { "package.json": '{\n  "dependencies": {\n    "lodash": "4.17.21",\n    "react-native": "0.76.0"\n  }\n}\n' });
    verify(root, { lane: "app" });
    assert.notEqual(tierOf(root), "3");
    write(root, { "package.json": '{\n  "dependencies": {\n    "expo-camera": "16.0.0",\n    "lodash": "4.17.21",\n    "react-native": "0.76.0"\n  }\n}\n' });
    verify(root, { lane: "app" });
    assert.equal(tierOf(root), "3");
    assert.match(evidenceText(root), /package\.json \(native dependency: expo-camera\)/);
  });

  it("send a native change to a deep review", () => {
    const root = rnProject();
    write(root, { "app.json": '{ "expo": { "name": "b" } }\n' });
    node("run-verify.mjs", [], { cwd: root });
    const r = node("review-brief.mjs", ["--lane", "app", "--request", "rename"], { cwd: root });
    assert.equal(r.code, 0, r.stderr);
    assert.match(r.stdout, /## Depth: deep \(native \(needs a store build\): app\.json\)/);
    assert.match(r.stdout, /frontend\/design-review\.md for the screenshots/);
  });
});
