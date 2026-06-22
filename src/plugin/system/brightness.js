const state = require('../state');
const { BRIGHTNESS_REFRESH_MS } = require('../constants');
const { commandExists, runCommand, clamp, warn, warnOnce } = require('../utils');
const { isMac } = require('../platform');

async function refreshMacBrightness(force = false) {
  const now = Date.now();

  if (!force && (now - state.lastBrightnessSync) < BRIGHTNESS_REFRESH_MS) {
    return state.monitorBrightnessAvailable;
  }

  state.lastBrightnessSync = now;

  if (!(await commandExists('brightness'))) {
    warnOnce('macos-brightness-unavailable', 'brightness tool not found; install with: brew install brightness');
    state.monitorBrightnessAvailable = false;
    return false;
  }

  const result = await runCommand('brightness -l', 2500);
  const match = result.stdout.match(/(?:current brightness|brightness)\s+([0-9]+(?:\.[0-9]+)?)/i);

  if (!result.error && match) {
    state.monitorBrightness = clamp(Math.round(Number.parseFloat(match[1]) * 100), 0, 100);
    state.monitorBrightnessAvailable = true;
    return true;
  }

  warnOnce('macos-brightness-read-failed', 'brightness read failed');
  state.monitorBrightnessAvailable = false;
  return false;
}

async function setMacBrightness(value) {
  state.monitorBrightness = clamp(value, 0, 100);

  if (!(await commandExists('brightness'))) {
    state.monitorBrightnessAvailable = false;
    return false;
  }

  clearTimeout(state.ddcutilTimeout);

  state.ddcutilTimeout = setTimeout(async () => {
    const percent = (state.monitorBrightness / 100).toFixed(2);
    const result = await runCommand(`brightness ${percent}`, 2500);

    if (result.error) {
      state.monitorBrightnessAvailable = false;
      warn('brightness set failed:', result.error.message || result.stderr || 'unknown error');
      return;
    }

    state.monitorBrightnessAvailable = true;
  }, 300);

  return true;
}

async function refreshMonitorBrightness(force = false) {
  if (isMac) {
    return refreshMacBrightness(force);
  }

  const now = Date.now();

  if (!force && (now - state.lastBrightnessSync) < BRIGHTNESS_REFRESH_MS) {
    return state.monitorBrightnessAvailable;
  }

  state.lastBrightnessSync = now;

  if (!(await commandExists('ddcutil'))) {
    state.monitorBrightnessAvailable = false;
    return false;
  }

  const result = await runCommand('ddcutil getvcp 10 --brief', 2500);
  const match =
    result.stdout.match(/current value =\s*([0-9]+)/i) ||
    result.stdout.match(/current value:\s*([0-9]+)/i) ||
    result.stdout.match(/C\s+([0-9]+)/);

  if (!result.error && match) {
    state.monitorBrightness = clamp(Number.parseInt(match[1], 10) || 50, 0, 100);
    state.monitorBrightnessAvailable = true;
    return true;
  }

  warnOnce('ddcutil-brightness-read-failed', 'ddcutil brightness read failed');
  state.monitorBrightnessAvailable = false;
  return false;
}

async function setMonitorBrightness(value) {
  if (isMac) {
    return setMacBrightness(value);
  }

  state.monitorBrightness = clamp(value, 0, 100);

  if (!(await commandExists('ddcutil'))) {
    state.monitorBrightnessAvailable = false;
    return false;
  }

  clearTimeout(state.ddcutilTimeout);

  state.ddcutilTimeout = setTimeout(async () => {
    const result = await runCommand(`ddcutil setvcp 10 ${state.monitorBrightness} --noverify`, 2500);

    if (result.error) {
      state.monitorBrightnessAvailable = false;
      warn('ddcutil brightness set failed:', result.error.message || result.stderr || 'unknown error');
      return;
    }

    state.monitorBrightnessAvailable = true;
  }, 300);

  return true;
}

function getBrightnessState() {
  return {
    monitorBrightness: state.monitorBrightness,
    monitorBrightnessAvailable: state.monitorBrightnessAvailable,
  };
}

module.exports = {
  refreshMonitorBrightness,
  setMonitorBrightness,
  getBrightnessState,
};
