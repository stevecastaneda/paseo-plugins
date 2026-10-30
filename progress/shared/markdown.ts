// Text files as the preview dialog gets them.

// How far back from a cut to look for a line break. A file with none that close
// (minified, or one long line) is cut mid-line rather than lose that much.
const LINE_SEARCH_BYTES = 8 * 1024;

// The text of the first bytes of a file. When the file goes on past them, the
// text ends after its last whole line, so the preview never ends on half a
// character, half a table row or half a link.
export function previewText(bytes: Uint8Array, truncated: boolean): string {
  return new TextDecoder().decode(truncated ? cleanCut(bytes) : bytes);
}

function cleanCut(bytes: Uint8Array): Uint8Array {
  let end = bytes.length;
  // Back over UTF-8 continuation bytes to the last character's first byte, and
  // drop that character when the cut left it short.
  for (let back = 1; back <= Math.min(4, end); back++) {
    const byte = bytes[end - back];
    if ((byte & 0xc0) === 0x80) continue;
    const length = byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    if (length > back) end -= back;
    break;
  }
  const newline = end ? bytes.lastIndexOf(0x0a, end - 1) : -1;
  if (newline >= 0 && end - (newline + 1) <= LINE_SEARCH_BYTES) end = newline + 1;
  return bytes.subarray(0, end);
}
