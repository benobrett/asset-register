// Thin wrapper around <input type="file" capture="environment"> — see
// CLAUDE.md "Camera capture" for why this is used instead of getUserMedia().

// Straight off a tablet camera an image is several megabytes, and an
// asset can now carry four of them - which sit in IndexedDB until a
// connection comes back. A handful of unsynced assets at full size is
// enough to threaten the browser's storage quota, and to make the
// eventual upload punishing on a field connection.
//
// 1600px on the longest edge at JPEG 0.8 is visually indistinguishable
// for a condition record and roughly an order of magnitude smaller. Done
// once here, at capture, rather than at upload time, so the queue itself
// stays small rather than just the request that drains it.
const MAX_EDGE_PX = 1600;
const JPEG_QUALITY = 0.8;

export async function downscaleImage(file, { maxEdge = MAX_EDGE_PX, quality = JPEG_QUALITY } = {}) {
  let bitmap;
  try {
    // from-image so a photo taken in portrait isn't silently rotated:
    // cameras record orientation as EXIF metadata rather than in the
    // pixels, and drawing to a canvas otherwise discards it.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    // Unreadable, or a format this browser can't decode - queue what we
    // were handed rather than losing the capture over a resize.
    return file;
  }

  try {
    const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
    // Re-encoded even when it was already under the size limit: the
    // source is typically a high-quality JPEG, so the recompression is
    // worth more than the resize on its own.
    return blob ?? file;
  } catch {
    return file;
  } finally {
    bitmap.close();
  }
}

// Always .jpg, since downscaleImage re-encodes to JPEG - carrying the
// original file's extension through would mislabel the stored object.
export function buildPhotoPath(userId) {
  return `${userId}/${crypto.randomUUID()}.jpg`;
}
