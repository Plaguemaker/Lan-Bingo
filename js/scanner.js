// Camera QR scanner. Uses the built-in BarcodeDetector where it exists
// (Chrome on Android) and falls back to jsQR everywhere else (iOS, Firefox, desktop).

let jsQRPromise = null;
function loadJsQR() {
  if (!jsQRPromise) {
    jsQRPromise = new Promise((resolve, reject) => {
      if (window.jsQR) return resolve(window.jsQR);
      const s = document.createElement('script');
      s.src = new URL('../vendor/jsQR.js', import.meta.url).href;
      s.onload = () => resolve(window.jsQR);
      s.onerror = () => reject(new Error('Could not load the QR reader.'));
      document.head.appendChild(s);
    });
  }
  return jsQRPromise;
}

async function makeDetector() {
  if ('BarcodeDetector' in window) {
    try {
      const formats = await window.BarcodeDetector.getSupportedFormats();
      if (formats.includes('qr_code')) {
        const det = new window.BarcodeDetector({ formats: ['qr_code'] });
        return async (video) => {
          const found = await det.detect(video);
          return found.length ? found[0].rawValue : null;
        };
      }
    } catch { /* fall back */ }
  }
  const jsQR = await loadJsQR();
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  return async (video) => {
    const w = video.videoWidth, h = video.videoHeight;
    if (!w || !h) return null;
    const scale = Math.min(1, 720 / Math.max(w, h));
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const code = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    return code ? code.data : null;
  };
}

// Starts scanning into `video`. Calls onResult(text) once, then stops.
// Returns a stop() function.
export async function startScanner(video, onResult) {
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    throw new Error('This browser cannot use the camera here. Open the app over https, or paste the link instead.');
  }
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: { ideal: 'environment' } },
    audio: false,
  });
  video.srcObject = stream;
  video.setAttribute('playsinline', '');
  video.muted = true;
  await video.play();
  const detect = await makeDetector();

  let stopped = false;
  const stop = () => {
    stopped = true;
    stream.getTracks().forEach((t) => t.stop());
    video.srcObject = null;
  };
  const tick = async () => {
    if (stopped) return;
    try {
      const text = await detect(video);
      if (text) {
        stop();
        onResult(text);
        return;
      }
    } catch { /* keep trying */ }
    setTimeout(tick, 150);
  };
  tick();
  return stop;
}
