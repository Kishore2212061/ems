/** Reads a QR from the current video frame; null when none is visible. */
export type FrameReader = (video: HTMLVideoElement) => Promise<string | null>;

interface NativeDetector {
  detect(source: HTMLVideoElement): Promise<{ rawValue: string }[]>;
}
type DetectorCtor = { new (o: { formats: string[] }): NativeDetector; getSupportedFormats?: () => Promise<string[]> };

/**
 * The browser's own BarcodeDetector where it exists (Chrome on Android: 0 KB, hardware-fast);
 * otherwise qr-scanner's worker decoder, loaded only now (iPhone, desktop browsers).
 */
export async function createFrameReader(): Promise<{ read: FrameReader; native: boolean }> {
  const BD = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  if (BD) {
    try {
      const formats = (await BD.getSupportedFormats?.()) ?? ['qr_code'];
      if (formats.includes('qr_code')) {
        const d = new BD({ formats: ['qr_code'] });
        return { native: true, read: async (v) => (await d.detect(v))[0]?.rawValue ?? null };
      }
    } catch {
      /* fall through to the worker decoder */
    }
  }
  // qr-scanner: a trimmed decoder in a Web Worker (~16 KB gz, loaded only here), off the main thread.
  const { default: QrScanner } = await import('qr-scanner');
  const engine = await QrScanner.createQrEngine();
  const canvas = document.createElement('canvas');
  return {
    native: false,
    read: async (v) => {
      if (!v.videoWidth) return null;
      try {
        return (await QrScanner.scanImage(v, { returnDetailedScanResult: true, qrEngine: engine, canvas })).data || null;
      } catch {
        return null; // no QR in this frame
      }
    },
  };
}

/** A stable id for this phone, so "already used" can say which scanner admitted the ticket. */
export function deviceId() {
  let id = localStorage.getItem('ems-device-id');
  if (!id) {
    id = `dev-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem('ems-device-id', id);
  }
  return id;
}
