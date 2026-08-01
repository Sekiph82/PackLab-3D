const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const frontendRoot = path.resolve(__dirname, '..');
const projectRoot = path.resolve(frontendRoot, '..', '..');
const releaseRoot = path.join(projectRoot, 'release');

function git(args, fallback = '') {
  try {
    return execFileSync('git', args, { cwd: projectRoot, encoding: 'utf8' }).trim();
  } catch (_err) {
    return fallback;
  }
}

function fileEntry(relativePath) {
  const fullPath = path.join(releaseRoot, relativePath);
  const data = fs.readFileSync(fullPath);
  return {
    path: relativePath.replace(/\\/g, '/'),
    sha256: crypto.createHash('sha256').update(data).digest('hex'),
    size: data.length,
  };
}

const pkg = JSON.parse(fs.readFileSync(path.join(frontendRoot, 'package.json'), 'utf8'));
const manifest = {
  appVersion: pkg.version || 'unknown',
  buildDate: new Date().toISOString(),
  gitCommit: git(['rev-parse', 'HEAD'], 'unknown'),
  gitBranch: git(['rev-parse', '--abbrev-ref', 'HEAD'], 'unknown'),
  electronVersion: pkg.devDependencies?.electron || null,
  threeVersion: pkg.devDependencies?.three || null,
  backendVersion: '0.1.0',
  open3dVersion: null,
  architecture: 'x64',
  backendPackaging: 'onedir',
  rendererBundler: 'vite',
  files: {
    executable: fileEntry('PackLab3D.exe'),
    asar: fileEntry(path.join('resources', 'app.asar')),
    backend: fileEntry(path.join('resources', 'backend', 'PackLab3DBackend.exe')),
  },
};

fs.writeFileSync(path.join(releaseRoot, 'release-manifest.json'), JSON.stringify(manifest, null, 2));
console.log('[generate-release-manifest] OK');
