const { commandExists, runCommand, clamp } = require('../utils');
const { isMac } = require('../platform');

async function getMacAudio() {
  const volResult = await runCommand('osascript -e "output volume of (get volume settings)"', 2000);
  const muteResult = await runCommand('osascript -e "output muted of (get volume settings)"', 2000);

  if (volResult.error && muteResult.error) {
    return { available: false, vol: 0, muted: false };
  }

  const vol = Number.parseInt(volResult.stdout.trim(), 10);
  const muted = muteResult.stdout.trim() === 'true';

  return {
    available: true,
    vol: clamp(Number.isFinite(vol) ? vol : 0, 0, 100),
    muted,
  };
}

async function adjustMacVolume(ticks, stepPercent = 2) {
  const step = clamp(Number.parseInt(stepPercent, 10) || 2, 1, 20);
  const current = await getMacAudio();
  const newVol = clamp(current.vol + (ticks > 0 ? step : -step), 0, 100);
  await runCommand(`osascript -e "set volume output volume ${newVol} without output muted"`, 1500);
  return true;
}

async function toggleMacMute() {
  const current = await getMacAudio();
  const muteExpr = current.muted ? 'without output muted' : 'with output muted';
  await runCommand(`osascript -e "set volume ${muteExpr}"`, 1500);
  return true;
}

async function getAudio() {
  if (isMac) {
    return getMacAudio();
  }

  if (!(await commandExists('wpctl'))) {
    return { available: false, vol: 0, muted: false };
  }

  const result = await runCommand('wpctl get-volume @DEFAULT_AUDIO_SINK@', 2000);
  if (result.error || !result.stdout) {
    return { available: false, vol: 0, muted: false };
  }

  const match = result.stdout.match(/([0-9]*\.?[0-9]+)/);
  const volume = match ? Math.round(Number.parseFloat(match[1]) * 100) : 0;
  const muted = result.stdout.includes('MUTED');

  return {
    available: true,
    vol: clamp(Number.isFinite(volume) ? volume : 0, 0, 100),
    muted,
  };
}

async function adjustVolume(ticks, stepPercent = 2) {
  if (isMac) {
    return adjustMacVolume(ticks, stepPercent);
  }

  if (!(await commandExists('wpctl'))) return false;
  const step = clamp(Number.parseInt(stepPercent, 10) || 2, 1, 20);
  await runCommand('wpctl set-mute @DEFAULT_AUDIO_SINK@ 0', 1500);
  await runCommand(`wpctl set-volume -l 1.0 @DEFAULT_AUDIO_SINK@ ${ticks > 0 ? `${step}%+` : `${step}%-`}`, 1500);
  return true;
}

async function toggleMute() {
  if (isMac) {
    return toggleMacMute();
  }

  if (!(await commandExists('wpctl'))) return false;
  await runCommand('wpctl set-mute @DEFAULT_AUDIO_SINK@ toggle', 1500);
  return true;
}

module.exports = {
  getAudio,
  adjustVolume,
  toggleMute,
};
