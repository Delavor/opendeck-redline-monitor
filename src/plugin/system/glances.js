const http = require('http');
const { spawn } = require('child_process');
const { warnOnce, warn, log, commandExists } = require('../utils');

const GLANCES_HOST = '127.0.0.1';
const GLANCES_PORT = 61208;
const CACHE_MS = 5000;
const MANAGED_RETRY_MS = 5000;   // short retry while our process is starting up
const EXTERNAL_RETRY_MS = 30000; // long retry when we don't own the process

let dataCache = { timestamp: 0, data: null };
let lastFailTimestamp = 0;
let glancesProcess = null;
let managedByPlugin = false;

function httpGetJson(path) {
  return new Promise((resolve) => {
    const req = http.get(
      { hostname: GLANCES_HOST, port: GLANCES_PORT, path, timeout: 1500 },
      (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try { resolve({ ok: true, data: JSON.parse(body) }); }
          catch { resolve({ ok: false, data: null }); }
        });
      }
    );
    req.on('error', () => resolve({ ok: false, data: null }));
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, data: null }); });
  });
}

async function isGlancesApiRunning() {
  const result = await httpGetJson('/api/3/cpu');
  return result.ok;
}

async function waitForGlancesReady(maxMs = 15000) {
  const step = 500;
  const attempts = Math.ceil(maxMs / step);

  for (let i = 0; i < attempts; i++) {
    await new Promise((r) => setTimeout(r, step));
    if (!glancesProcess) return;
    if (await isGlancesApiRunning()) {
      log('glances server is ready');
      lastFailTimestamp = 0;
      dataCache = { timestamp: 0, data: null };
      return;
    }
  }

  warn(`glances server did not become ready within ${maxMs / 1000}s`);
}

async function startGlancesServer() {
  if (await isGlancesApiRunning()) {
    log('glances server already running (external)');
    managedByPlugin = false;
    lastFailTimestamp = 0;
    return;
  }

  if (!(await commandExists('glances'))) {
    warnOnce('glances-not-installed', 'glances not installed — install with: pip install glances[all]');
    return;
  }

  log('Starting glances web server...');

  glancesProcess = spawn('glances', ['-w', '-B', GLANCES_HOST, '--disable-browser', '-q'], {
    stdio: 'ignore',
    detached: false,
  });

  managedByPlugin = true;

  glancesProcess.on('error', (err) => {
    warnOnce('glances-spawn-error', `glances spawn failed: ${err.message}`);
    glancesProcess = null;
    managedByPlugin = false;
  });

  glancesProcess.on('exit', (code, signal) => {
    if (managedByPlugin) {
      warn(`glances server exited (code=${code}, signal=${signal})`);
    }
    glancesProcess = null;
    managedByPlugin = false;
    dataCache = { timestamp: 0, data: null };
  });

  // Poll for readiness without blocking plugin startup
  waitForGlancesReady(15000).catch(() => {});
}

function stopGlancesServer() {
  if (!managedByPlugin || !glancesProcess) return;

  log('Stopping glances server...');

  try {
    glancesProcess.kill('SIGTERM');
  } catch (e) {
    // Already dead
  }

  glancesProcess = null;
  managedByPlugin = false;
}

function findCpuTemp(sensors) {
  if (!Array.isArray(sensors) || sensors.length === 0) return null;

  const cpuSensors = sensors.filter((s) =>
    s.type === 'temperature_core' && /cpu|core|package|die/i.test(s.label || '')
  );
  const candidates = cpuSensors.length > 0 ? cpuSensors : sensors.filter((s) => s.type === 'temperature_core');

  const temps = candidates.map((s) => Number(s.value)).filter(Number.isFinite);
  if (!temps.length) return null;

  return Math.round(Math.max(...temps));
}

async function fetchGlancesData() {
  const now = Date.now();

  if (dataCache.data !== null && (now - dataCache.timestamp) < CACHE_MS) {
    return dataCache.data;
  }

  const retryMs = managedByPlugin ? MANAGED_RETRY_MS : EXTERNAL_RETRY_MS;
  if (now - lastFailTimestamp < retryMs) {
    return null;
  }

  const [cpuResult, sensorsResult, qlResult] = await Promise.all([
    httpGetJson('/api/3/cpu'),
    httpGetJson('/api/3/sensors'),
    httpGetJson('/api/3/quicklook'),
  ]);

  if (!cpuResult.ok) {
    lastFailTimestamp = now;
    dataCache = { timestamp: now, data: null };

    if (!managedByPlugin) {
      commandExists('glances').then((installed) => {
        if (installed) {
          warnOnce('glances-not-running', 'glances is installed but not running as web server — start with: glances -w');
        }
      });
    }

    return null;
  }

  const load = Number(cpuResult.data?.total);
  const temp = findCpuTemp(sensorsResult.data);

  const wattsRaw = Number(
    qlResult.data?.cpu_power
    ?? qlResult.data?.cpupower
    ?? NaN
  );
  const watts = Number.isFinite(wattsRaw) && wattsRaw > 0 ? Math.round(wattsRaw * 10) / 10 : null;

  const data = {
    load: Number.isFinite(load) ? Math.round(load) : null,
    temp,
    watts,
  };

  dataCache = { timestamp: now, data };
  return data;
}

module.exports = { fetchGlancesData, startGlancesServer, stopGlancesServer };
