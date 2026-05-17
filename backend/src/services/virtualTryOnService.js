import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs/promises';

/**
 * Runs the CP-VTON Python script on a pair of images.
 *
 * This helper simply shells out to a Python script located in
 * `backend/tryon-model`.  The script is responsible for loading the
 * CP-VTON network, performing any necessary preprocessing, and writing
 * the resulting "try-on" image to disk.
 *
 * The Node side only cares about audio paths and that the script
 * returns with exit code 0.  The script is expected to accept three
 * positional arguments in the following order:
 *
 *    1. path to the person image (jpg/png)
 *    2. path to the clothes image (jpg/png)
 *    3. output path where the composited result should be written
 *
 * The implementation below is intentionally lightweight; if the
 * repository's existing `test.py` does not support this signature you
 * can create a thin wrapper (e.g. `tryon-model/run.py`) that does so.
 *
 * A simple Python virtual environment can be created inside
 * `tryon-model` and the packages listed in
 * `tryon-model/environment.yml` (or the project's README) installed.
 * Typical requirements include `torch`, `opencv-python`, `numpy`,
 * `Pillow`, etc.  See the repository's docs for full details.
 *
 * @param {string} personImagePath  local filesystem path (absolute or relative)
 * @param {string} clothesImagePath local filesystem path (absolute or relative)
 * @returns {Promise<Object>} resolves with `{ success: true, resultImageUrl }`
 */
export const runVirtualTryOn = async (personImagePath, clothesImagePath) => {
  // ensure outputs directory exists
  const outputDir = path.join(process.cwd(), 'outputs');
  await fs.mkdir(outputDir, { recursive: true });

  const timestamp = Date.now();
  const resultFilename = `result-${timestamp}.png`;
  const resultLocalPath = path.join(outputDir, resultFilename);

  // path to the Python wrapper script inside the cloned repo
  const scriptPath = path.join(process.cwd(), 'tryon-model', 'run.py');

  return new Promise((resolve, reject) => {
    console.log('🚀 Starting CP-VTON script', scriptPath);

    // determine which python to call.  callers may set CP_VTON_PYTHON to
    // override; otherwise look for a virtualenv inside tryon-model.  This
    // prevents the common "spawn python ENOENT" error when the system-wide
    // python is not on PATH.
    let pythonExec = process.env.CP_VTON_PYTHON;
    if (!pythonExec) {
      const venvBase = path.join(process.cwd(), 'tryon-model', 'venv');
      if (process.platform === 'win32') {
        pythonExec = path.join(venvBase, 'Scripts', 'python.exe');
      } else {
        pythonExec = path.join(venvBase, 'bin', 'python');
      }
    }

    console.log('🔍 Using python interpreter:', pythonExec);
    const python = spawn(pythonExec || 'python', [scriptPath, personImagePath, clothesImagePath, resultLocalPath], {
      cwd: path.join(process.cwd(), 'tryon-model'),
    });

    python.stdout.on('data', (data) => {
      process.stdout.write(`[CP-VTON] ${data}`);
    });

    python.stderr.on('data', (data) => {
      process.stderr.write(`[CP-VTON ERR] ${data}`);
    });

    python.on('error', (err) => {
      console.error('❌ Failed to start Python process:', err);
      reject({ success: false, error: err.message });
    });

    python.on('close', (code) => {
      if (code === 0) {
        console.log('✅ CP-VTON finished successfully');
        resolve({ success: true, resultImageUrl: `/outputs/${resultFilename}` });
      } else {
        console.error(`❌ CP-VTON exited with code ${code}`);
        reject({ success: false, error: `Python script failed (exit ${code})` });
      }
    });
  });
};

export default { runVirtualTryOn };
