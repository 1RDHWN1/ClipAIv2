import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

let cachedGpuInfo = undefined;

/**
 * Detect available GPU hardware acceleration for video encoding.
 * Specifically checks for Linux VAAPI devices (/dev/dri/renderD*) and AMD/Intel drivers.
 *
 * @param {boolean} [forceRefresh=false]
 * @returns {{ supported: boolean, type: string|null, device: string|null, driver: string|null, encoder: string|null, name: string }}
 */
export function detectHardwareAcceleration(forceRefresh = false) {
  if (cachedGpuInfo !== undefined && !forceRefresh) {
    return cachedGpuInfo;
  }

  const defaultResult = {
    supported: false,
    type: null,
    device: null,
    driver: null,
    encoder: null,
    name: 'CPU Software (libx264)',
  };

  // 1. Check for VAAPI render device node in Linux
  const possibleDevices = ['/dev/dri/renderD128', '/dev/dri/renderD129'];
  let activeDevice = null;

  for (const dev of possibleDevices) {
    try {
      if (fs.existsSync(dev)) {
        fs.accessSync(dev, fs.constants.R_OK | fs.constants.W_OK);
        activeDevice = dev;
        break;
      }
    } catch (_) {
      // Device node exists but no read/write access
    }
  }

  if (!activeDevice) {
    cachedGpuInfo = defaultResult;
    return cachedGpuInfo;
  }

  // 2. Identify driver: check radeonsi (AMD) or iHD/i965 (Intel)
  let activeDriver = null;
  let gpuName = 'GPU Hardware Acceleration';

  try {
    const driPath = '/usr/lib/x86_64-linux-gnu/dri';
    if (fs.existsSync(`${driPath}/radeonsi_drv_video.so`)) {
      activeDriver = 'radeonsi';
      gpuName = 'AMD Radeon (VAAPI VCN)';
    } else if (fs.existsSync(`${driPath}/iHD_drv_video.so`)) {
      activeDriver = 'iHD';
      gpuName = 'Intel QuickSync (VAAPI)';
    }
  } catch (_) {}

  // 3. Quick sanity probe with ffmpeg to ensure h264_vaapi actually encodes cleanly
  try {
    const env = { ...process.env };
    if (activeDriver) {
      env.LIBVA_DRIVER_NAME = activeDriver;
    }

    const probe = spawnSync(
      'ffmpeg',
      [
        '-y',
        '-vaapi_device', activeDevice,
        '-f', 'lavfi', '-i', 'testsrc=duration=0.1:size=128x128:rate=10',
        '-vf', 'format=nv12,hwupload',
        '-c:v', 'h264_vaapi',
        '-f', 'null', '-',
      ],
      { env, timeout: 2000, stdio: 'pipe' }
    );

    if (probe.status === 0) {
      cachedGpuInfo = {
        supported: true,
        type: 'vaapi',
        device: activeDevice,
        driver: activeDriver,
        encoder: 'h264_vaapi',
        name: gpuName,
      };
      return cachedGpuInfo;
    }
  } catch (_) {
    // Probe failed or timed out
  }

  cachedGpuInfo = defaultResult;
  return cachedGpuInfo;
}

/**
 * Resolve effective hardware acceleration options based on environment and user preference.
 *
 * @param {Object} [options={}]
 * @param {boolean|string} [options.hwaccel] - 'auto' | 'vaapi' | 'cpu' | boolean
 * @returns {{ enabled: boolean, type: string|null, device: string|null, driver: string|null, encoder: string, name: string }}
 */
export function getHardwareAccelerationConfig(options = {}) {
  const envPref = (process.env.HARDWARE_ACCELERATION || 'auto').toLowerCase().trim();
  const optionPref = options.hwaccel !== undefined ? options.hwaccel : envPref;

  if (optionPref === false || optionPref === 'cpu' || optionPref === 'none') {
    return {
      enabled: false,
      type: null,
      device: null,
      driver: null,
      encoder: 'libx264',
      name: 'CPU Software (libx264)',
    };
  }

  const detected = detectHardwareAcceleration();
  if (detected.supported) {
    return {
      enabled: true,
      ...detected,
    };
  }

  return {
    enabled: false,
    type: null,
    device: null,
    driver: null,
    encoder: 'libx264',
    name: 'CPU Software (libx264)',
  };
}
