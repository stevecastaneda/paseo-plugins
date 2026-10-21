import { useSettings } from "@getpaseo/plugin/client";
import React, { createContext, useContext } from "react";
import { displaySettings } from "../shared/settings";
import { messagesFor, resolveLocale } from "./i18n";

function useLanguageSettings() {
  const settings = useSettings(displaySettings);
  const locale = resolveLocale(settings.status === "ready" ? settings.values.language : "system");
  return { locale, messages: messagesFor(locale), settings };
}

const LanguageContext = createContext<ReturnType<typeof useLanguageSettings> | null>(null);

export function ProgressLanguageProvider({ children }: { children: React.ReactNode }) {
  const language = useLanguageSettings();
  return <LanguageContext.Provider value={language}>{children}</LanguageContext.Provider>;
}

export function useProgressLanguage() {
  const language = useContext(LanguageContext);
  if (!language) throw new Error("ProgressLanguageProvider is missing");
  return language;
}
