// In-memory list of the scans taken this session. Nothing is written to disk:
// refreshing or closing the page loses them.
//
// Each scan is stored as a lossless PNG Blob, so exporting as PNG keeps full
// quality and exporting as JPG compresses only once.

let counter = 0;

export function createScanSession() {
  /** @type {{id:string, blob:Blob, url:string, thumbUrl:string, width:number, height:number, exported:boolean}[]} */
  let scans = [];

  const revoke = (scan) => {
    URL.revokeObjectURL(scan.url);
    URL.revokeObjectURL(scan.thumbUrl);
  };

  return {
    /** Adds a scan. `blob` is the full scan, `thumb` a small preview. */
    add({ blob, thumb, width, height }) {
      const scan = {
        id: `scan-${Date.now().toString(36)}-${++counter}`,
        blob,
        url: URL.createObjectURL(blob),
        thumbUrl: URL.createObjectURL(thumb),
        width,
        height,
        exported: false,
      };
      scans = [...scans, scan];
      return scan;
    },

    /** Replaces a scan's image (e.g. after rotating). Marks it as not exported. */
    replace(id, { blob, thumb, width, height }) {
      const old = this.get(id);
      if (!old) return null;
      const next = {
        ...old,
        blob,
        url: URL.createObjectURL(blob),
        thumbUrl: URL.createObjectURL(thumb),
        width,
        height,
        exported: false,
      };
      scans = scans.map((s) => (s.id === id ? next : s));
      revoke(old);
      return next;
    },

    remove(id) {
      const old = this.get(id);
      if (!old) return;
      scans = scans.filter((s) => s.id !== id);
      revoke(old);
    },

    markAllExported() {
      scans = scans.map((s) => ({ ...s, exported: true }));
    },

    get(id) {
      return scans.find((s) => s.id === id) ?? null;
    },

    indexOf(id) {
      return scans.findIndex((s) => s.id === id);
    },

    /** A snapshot of all scans, oldest first. */
    all() {
      return scans;
    },

    get count() {
      return scans.length;
    },

    get hasUnexported() {
      return scans.some((s) => !s.exported);
    },
  };
}
