// A photo picked for a photo take, made small before it's sent: upright (the browser applies the
// photo's EXIF turn when it decodes), 1280 px on the long side, a JPEG. Twenty phone photos go from
// ~80 MB to ~4 MB, and their metadata (where they were taken) never leaves the phone. The server turns
// and sizes every photo again anyway (server/photoInput.ts), so a photo the browser can't decode (a HEIC
// outside Safari) is sent as it is.
const LONG_SIDE = 1280;

async function decode(file: Blob): Promise<{ draw: CanvasImageSource; w: number; h: number; done: () => void }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { draw: bmp, w: bmp.width, h: bmp.height, done: () => bmp.close() };
  } catch {
    // Older Safari: an <img> is drawn upright too.
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.decoding = "async";
      img.src = url;
      await img.decode();
      return { draw: img, w: img.naturalWidth, h: img.naturalHeight, done: () => {} };
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}

// The small JPEG, or null when this browser can't read the photo.
export async function shrinkPhoto(file: File): Promise<Blob | null> {
  let picture: Awaited<ReturnType<typeof decode>>;
  try {
    picture = await decode(file);
  } catch {
    return null;
  }
  try {
    const k = Math.min(1, LONG_SIDE / Math.max(picture.w, picture.h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(picture.w * k));
    canvas.height = Math.max(1, Math.round(picture.h * k));
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(picture.draw, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
  } finally {
    picture.done();
  }
}
