// Hands finished image files to the phone.
//
// On iOS Safari this opens the share sheet, where "Save Images" adds them to
// Photos. navigator.share() must be called directly from a tap, so files are
// prepared first and shared on a separate tap.

/** True when this browser can share image files through the share sheet. */
export function canShareFiles(files) {
  try {
    return !!navigator.canShare && navigator.share && navigator.canShare({ files });
  } catch {
    return false;
  }
}

/**
 * Shares or downloads the files.
 * @returns {Promise<'shared'|'downloaded'|'cancelled'>}
 */
export async function exportFiles(files) {
  if (canShareFiles(files)) {
    try {
      await navigator.share({ files });
      return 'shared';
    } catch (error) {
      if (error?.name === 'AbortError') return 'cancelled';
      throw error;
    }
  }
  await download(files);
  return 'downloaded';
}

async function download(files) {
  for (const file of files) {
    const url = URL.createObjectURL(file);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.rel = 'noopener';
    a.style.display = 'none';
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    // Browsers drop rapid back-to-back downloads; space them out.
    await new Promise((r) => setTimeout(r, 400));
  }
}
