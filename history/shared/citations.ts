const FENCE = /^ {0,3}(`{3,}|~{3,})/;
// A citation runs to its closing tag, or to the end of the text when Codex cut it off.
// Code spans come first in the alternation so a citation quoted inside one stays visible.
const INLINE = /(`+)[\s\S]*?\1|<oai-mem-citation>[\s\S]*?(?:<\/oai-mem-citation>|$)/g;

// Codex appends memory citations as private metadata. Paseo's Markdown would print
// their contents as a paragraph, so drop them, except inside fenced or inline code.
export function hideCitations(source: string): string {
  if (!source.includes("<oai-mem-citation>")) return source;
  let result = "";
  let prose = "";
  let fence: string | null = null;
  for (const line of source.split(/(?<=\n)/)) {
    const marker = FENCE.exec(line)?.[1];
    if (fence) {
      result += line;
      if (marker && marker[0] === fence[0] && marker.length >= fence.length && !line.slice(line.indexOf(marker) + marker.length).trim()) fence = null;
    } else if (marker) {
      result += strip(prose) + line;
      prose = "";
      fence = marker;
    } else prose += line;
  }
  return (result + strip(prose)).trimEnd();
}

function strip(prose: string): string {
  return prose.replace(INLINE, (match, ticks) => ticks ? match : "").replace(/\n{3,}/g, "\n\n");
}
