import { Platform } from "react-native";

// Code and commands: the platform's monospace face.
export const mono = () => (Platform.OS === "ios" ? "Menlo" : Platform.OS === "web" ? "ui-monospace, SFMono-Regular, Menlo, monospace" : "monospace");
