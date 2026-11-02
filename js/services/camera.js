// Back camera access via getUserMedia.
//
// The stream is kept open for the whole session (pausing the preview while
// another screen is shown) so iOS doesn't ask for permission again. If iOS
// stops the stream (e.g. the app was in the background) it is restarted.

const CONSTRAINTS = {
  audio: false,
  video: {
    facingMode: { ideal: 'environment' },
    // Ask for the highest resolution; the browser picks the closest it supports.
    width: { ideal: 4032 },
    height: { ideal: 3024 },
  },
};

export class CameraError extends Error {
  constructor(kind, message) {
    super(message);
    this.kind = kind; // 'denied' | 'error'
  }
}

export function createCamera(video) {
  let stream = null;
  let starting = null;

  video.setAttribute('playsinline', '');
  video.muted = true;

  const isLive = () => !!stream && stream.getVideoTracks().some((t) => t.readyState === 'live');

  async function start() {
    if (isLive()) {
      await video.play().catch(() => {});
      return;
    }
    if (starting) return starting;

    starting = (async () => {
      if (!window.isSecureContext) {
        throw new CameraError('error', 'The camera only works when this page is opened over HTTPS.');
      }
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new CameraError('error', "This browser doesn't support camera access. Open the page in Safari.");
      }
      stop();
      try {
        stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
      } catch (error) {
        throw toCameraError(error);
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      await waitForFrames(video);
    })();

    try {
      await starting;
    } finally {
      starting = null;
    }
  }

  function stop() {
    if (stream) for (const t of stream.getTracks()) t.stop();
    stream = null;
    video.srcObject = null;
  }

  return {
    start,
    stop,

    /** Pauses the preview without releasing the camera. */
    pause() {
      video.pause();
    },

    get isLive() {
      return isLive();
    },

    /** Grabs the current frame at full resolution. */
    capture() {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!isLive() || !w || !h) throw new CameraError('error', 'The camera is not ready yet.');
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      canvas.getContext('2d').drawImage(video, 0, 0, w, h);
      return canvas;
    },
  };
}

function waitForFrames(video) {
  if (video.videoWidth > 0) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      video.removeEventListener('loadedmetadata', done);
      video.removeEventListener('playing', done);
      resolve();
    };
    video.addEventListener('loadedmetadata', done);
    video.addEventListener('playing', done);
    setTimeout(done, 4000);
  });
}

function toCameraError(error) {
  switch (error?.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        'denied',
        'Camera access was blocked. Allow it in Settings › Safari › Camera (or tap "aA" in the address bar › Website Settings), then try again.',
      );
    case 'NotFoundError':
    case 'OverconstrainedError':
      return new CameraError('error', 'No usable camera was found on this device.');
    case 'NotReadableError':
    case 'AbortError':
      return new CameraError('error', 'The camera is being used by another app. Close it and try again.');
    default:
      return new CameraError('error', 'The camera could not be started. Please try again.');
  }
}
