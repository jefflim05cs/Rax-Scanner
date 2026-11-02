// Encodes canvases into image files.

export const FORMATS = {
  jpg: { mime: 'image/jpeg', ext: 'jpg', quality: 0.92 },
  png: { mime: 'image/png', ext: 'png', quality: undefined },
};

/** Encodes a canvas as 'jpg' or 'png' (or with an explicit quality for previews). */
export function encode(canvas, format = 'jpg', quality) {
  const f = FORMATS[format];
  if (!f) throw new Error(`Unknown format: ${format}`);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not encode image'))),
      f.mime,
      quality ?? f.quality,
    );
  });
}

/** File name like "Rax-Scan-20261102-1405-03.jpg". */
export function fileName(date, index, format) {
  const p = (n, l = 2) => String(n).padStart(l, '0');
  const stamp = `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}`;
  return `Rax-Scan-${stamp}-${p(index + 1)}.${FORMATS[format].ext}`;
}
