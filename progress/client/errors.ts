// What a failed request says, for people. Paseo wraps a handler's error as
// "Request failed: <message> requestType=… code=…", which is for its logs.
export function errorText(error: unknown, fallback: string): string {
  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string") return fallback;
  return message.replace(/^Request failed: /, "").replace(/ requestType=\S+(?: code=\S+)?$/, "").trim() || fallback;
}
