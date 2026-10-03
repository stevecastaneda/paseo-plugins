import { createContext, useContext } from "react";

// Paseo opens the Explorer sidebar at 320px and plugins can't ask for more,
// so at or below this width the panel trims what it shows to fit.
export const NARROW_MAX = 400;

const Narrow = createContext(false);

export const NarrowProvider = Narrow.Provider;

export function useNarrow(): boolean {
  return useContext(Narrow);
}
