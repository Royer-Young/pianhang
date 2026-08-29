const fs = require('fs');
const path = require('path');

const API_BASE = (process.env.VITE_API_BASE_URL || process.env.REACT_APP_API_BASE_URL || 'http://localhost:8001').replace(/\/+$/, '');

function copyDir(src, dest) {
  if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
  fs.readdirSync(src).forEach(file => {
    const srcPath = path.join(src, file);
    const destPath = path.join(dest, file);
    if (fs.lstatSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  });
}

const rootDir = path.join(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

if (fs.existsSync(distDir)) fs.rmSync(distDir, { recursive: true });
fs.mkdirSync(distDir, { recursive: true });

['css', 'js'].forEach(dir => {
  copyDir(path.join(rootDir, dir), path.join(distDir, dir));
});

let html = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf-8');
const apiScript = `<script>window.__API_BASE__='${API_BASE}';</script>`;
html = html.replace(
  '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>',
  '<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>\n    ' + apiScript
);
fs.writeFileSync(path.join(distDir, 'index.html'), html);

let appJs = fs.readFileSync(path.join(rootDir, 'js', 'app.js'), 'utf-8');
appJs = appJs.replace(
  /var AI_BASE = 'http:\/\/localhost:8001';/,
  `var AI_BASE = (window.__API_BASE__ || 'http://localhost:8001').replace(/\\/+$/, '');`
);
fs.writeFileSync(path.join(distDir, 'js', 'app.js'), appJs);

console.log('Build complete. API_BASE=' + API_BASE);
