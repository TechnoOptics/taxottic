// Receipt capture bridge, native camera with a graceful web fallback.
//
// On the Capacitor native shell we open the real device camera via
// @capacitor/camera (the iOS NSCameraUsageDescription + Android
// CAMERA permission ship in the binary). On web, including mobile
// browsers, there is no plugin; the caller falls back to a
// `<input type="file" accept="image/*" capture="environment">`,
// which on a phone browser still opens the camera.
//
// Same graceful-degradation discipline as lib/capacitor/auth-bridge:
// @capacitor/camera's native code is compiled INTO the app binary, so
// an already-installed build that predates the plugin reports
// isPluginAvailable("Camera") === false. We MUST detect that and let
// the caller use the web input instead of calling a plugin that would
// throw "Camera plugin is not implemented".

export type ReceiptCaptureResult =
  | { kind: "file"; file: File }
  /** Not the native shell, or the plugin isn't in the running binary -
   *  the caller should trigger its web `<input capture>` fallback. */
  | { kind: "unavailable" }
  /** Native shell, plugin present, but the user backed out of the
   *  camera. Do NOT fall back to a file picker, they chose to stop. */
  | { kind: "cancelled" }
  | { kind: "error"; message: string };

/** True only inside the Capacitor native shell. Safe on SSR + web. */
async function isNativeShell(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  try {
    const { Capacitor } = await import("@capacitor/core");
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * Capture a receipt photo. Returns a `File` ready to POST to
 * /api/receipts/extract, or a sentinel telling the caller whether to
 * fall back to the web camera input or to stay put.
 */
export async function captureReceiptPhoto(): Promise<ReceiptCaptureResult> {
  if (!(await isNativeShell())) return { kind: "unavailable" };

  let CameraMod: typeof import("@capacitor/camera");
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isPluginAvailable("Camera")) {
      return { kind: "unavailable" };
    }
    CameraMod = await import("@capacitor/camera");
  } catch {
    return { kind: "unavailable" };
  }

  const { Camera, CameraResultType, CameraSource } = CameraMod;
  try {
    const photo = await Camera.getPhoto({
      quality: 70,
      // Uri keeps the image off the JS heap (a base64 receipt can be
      // multi-MB); we fetch the local webPath into a Blob just-in-time.
      resultType: CameraResultType.Uri,
      source: CameraSource.Camera,
      correctOrientation: true,
      saveToGallery: false,
      promptLabelHeader: "Receipt",
    });
    if (!photo.webPath) {
      return { kind: "error", message: "No photo was captured." };
    }
    const blob = await fetch(photo.webPath).then((r) => r.blob());
    const ext = photo.format || "jpeg";
    const file = new File([blob], `receipt-${Date.now()}.${ext}`, {
      type: blob.type || `image/${ext}`,
    });
    return { kind: "file", file };
  } catch (err) {
    // @capacitor/camera throws on user cancel. Its message/code varies
    // by platform ("User cancelled photos app" / "cancelled"), so
    // match loosely and treat anything cancel-shaped as a clean back-out.
    const msg = err instanceof Error ? err.message : String(err);
    if (/cancel/i.test(msg)) return { kind: "cancelled" };
    return { kind: "error", message: msg || "Couldn't open the camera." };
  }
}
