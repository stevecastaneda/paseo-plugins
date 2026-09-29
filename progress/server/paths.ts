import { isAbsolute, sep } from "node:path";

// Whether a path from relative(root, target) leaves the root. "..notes" is a
// name inside it, not a step out.
export function outside(inside: string): boolean {
  return inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside);
}
