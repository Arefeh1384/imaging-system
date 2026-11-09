// Prepares a photo of a paper document: reduces its size and raises its contrast.
// What the patient approves on screen is exactly the file that gets sent.

const MAX_SIDE = 1800;
const CONTRAST = 1.25;

export interface ScannedFile {
  file: File;
  previewUrl: string | null;
  isImage: boolean;
}

async function loadBitmap(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file);
  } catch {
    return null;
  }
}

export async function prepareScan(file: File): Promise<ScannedFile> {
  if (!file.type.startsWith('image/')) return { file, previewUrl: null, isImage: false };

  const bitmap = await loadBitmap(file);
  if (!bitmap) return { file, previewUrl: URL.createObjectURL(file), isImage: true };

  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) return { file, previewUrl: URL.createObjectURL(file), isImage: true };

  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const image = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = image;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const value = Math.max(0, Math.min(255, (gray - 128) * CONTRAST + 140));
    data[i] = value;
    data[i + 1] = value;
    data[i + 2] = value;
  }
  ctx.putImageData(image, 0, 0);

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.85));
  if (!blob) return { file, previewUrl: URL.createObjectURL(file), isImage: true };
  const scanned = new File([blob], file.name.replace(/\.[^.]+$/, '') + '-scan.jpg', { type: 'image/jpeg' });
  return { file: scanned, previewUrl: URL.createObjectURL(scanned), isImage: true };
}
