export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_COMPLETION_IMAGES = Number(
  import.meta.env.VITE_MAX_COMPLETION_IMAGES
) || 10;
export const ALLOWED_COMPLETION_IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);
