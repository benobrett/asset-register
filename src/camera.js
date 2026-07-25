// Thin wrapper around <input type="file" capture="environment"> — see
// CLAUDE.md "Camera capture" for why this is used instead of getUserMedia().

export function watchPhotoPreview(fileInput, previewEl) {
  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    if (!file) {
      previewEl.hidden = true;
      previewEl.removeAttribute('src');
      return;
    }
    previewEl.src = URL.createObjectURL(file);
    previewEl.hidden = false;
  });
}

export function buildPhotoPath(userId, file) {
  const extension = (file.name.split('.').pop() || 'jpg').toLowerCase();
  return `${userId}/${crypto.randomUUID()}.${extension}`;
}
