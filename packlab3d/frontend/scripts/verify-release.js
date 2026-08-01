const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const asar = require('@electron/asar');

const frontendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(frontendRoot, '..', '..');
const releaseRoot = path.join(projectRoot, 'release');
const appAsar = path.join(releaseRoot, 'resources', 'app.asar');

function fail(message) {
  console.error(`[verify-release] ERROR: ${message}`);
  process.exitCode = 1;
}

function mustExist(filePath, label) {
  if (!fs.existsSync(filePath)) fail(`${label} missing: ${filePath}`);
}

mustExist(path.join(releaseRoot, 'PackLab3D.exe'), 'PackLab3D.exe');
mustExist(appAsar, 'app.asar');
mustExist(path.join(releaseRoot, 'resources', 'backend', 'PackLab3DBackend.exe'), 'backend executable');
mustExist(path.join(releaseRoot, 'resources', 'logo-pack', '512x512 px.png'), 'logo resource');
mustExist(path.join(releaseRoot, 'release-manifest.json'), 'release manifest');

let files = [];
let archiveFiles = [];
try {
  archiveFiles = asar.listPackage(appAsar);
  files = archiveFiles.map((file) => file.replace(/\\/g, '/'));
} catch (err) {
  fail(`unable to read app.asar: ${err.message}`);
}

const rendererFiles = files.filter((file) => file.includes('/electron/renderer/dist/'));
if (!rendererFiles.some((file) => file.endsWith('/index.html'))) fail('renderer dist index.html missing from app.asar');
const jsBundles = rendererFiles.filter((file) => file.endsWith('.js'));
if (jsBundles.length === 0) fail('renderer JavaScript bundle missing from app.asar');

let combined = '';
for (const file of rendererFiles.filter((item) => item.endsWith('.html') || item.endsWith('.js'))) {
  const archiveFile = archiveFiles.find((item) => item.replace(/\\/g, '/') === file);
  combined += asar.extractFile(appAsar, archiveFile.replace(/^[\\/]/, '')).toString('utf8');
}

if (combined.includes('../../node_modules/three')) fail('runtime reference to ../../node_modules/three remains');
if (combined.includes('app.asar/node_modules/three/examples/jsm')) fail('runtime reference to app.asar/node_modules/three/examples/jsm remains');
if (files.some((file) => file.includes('/node_modules/three/examples/jsm/'))) {
  fail('Three.js addon source files are still packaged under app.asar/node_modules');
}
if (!combined.includes('GLTFLoader')) fail('GLTFLoader code was not found in renderer bundle');
if (!combined.includes('OrbitControls')) fail('OrbitControls code was not found in renderer bundle');
if (!combined.includes('threejs-viewer')) fail('viewer markup was not found in renderer bundle');

const pkg = JSON.parse(fs.readFileSync(path.join(frontendRoot, 'package.json'), 'utf8'));
if (!pkg.version) fail('package version missing');

try {
  const manifest = JSON.parse(fs.readFileSync(path.join(releaseRoot, 'release-manifest.json'), 'utf8'));
  if (manifest.rendererBundler !== 'vite') fail('manifest rendererBundler is not vite');
  if (manifest.backendPackaging !== 'onedir') fail('manifest backendPackaging is not onedir');
  for (const entry of Object.values(manifest.files || {})) {
    const fullPath = path.join(releaseRoot, entry.path);
    mustExist(fullPath, `manifest file ${entry.path}`);
    const data = fs.readFileSync(fullPath);
    const sha256 = crypto.createHash('sha256').update(data).digest('hex');
    if (entry.size !== data.length) fail(`manifest size mismatch for ${entry.path}`);
    if (entry.sha256 !== sha256) fail(`manifest sha256 mismatch for ${entry.path}`);
    if (path.isAbsolute(entry.path)) fail(`manifest contains absolute path: ${entry.path}`);
  }
} catch (err) {
  fail(`release manifest invalid: ${err.message}`);
}

if (process.exitCode) process.exit(process.exitCode);
console.log('[verify-release] OK');
