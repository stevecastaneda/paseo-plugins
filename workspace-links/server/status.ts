import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type { LinkStatus } from "../shared/links.ts";
import { readLinks } from "./links.ts";

const TIMEOUT_MS = 1_500;

/**
 * Any HTTP answer, even an error page, means a server is listening. Certificates go unchecked
 * because local HTTPS is usually self-signed and nothing from the response is used.
 */
export function probe(url: string, timeoutMs = TIMEOUT_MS): Promise<LinkStatus> {
  return new Promise((resolve) => {
    const request = (url.toLowerCase().startsWith("https:") ? httpsRequest : httpRequest)(
      url,
      { method: "HEAD", timeout: timeoutMs, rejectUnauthorized: false },
      (response) => {
        response.resume();
        resolve("up");
        request.destroy();
      },
    );
    request.on("timeout", () => request.destroy());
    request.on("error", () => resolve("down"));
    request.end();
  });
}

/** Checks only the URLs in the workspace's own file, never ones the client names. */
export async function handleGetLinkStatus(input: { workspaceId: string; workspaceDirectory: string }) {
  const { links } = await readLinks(input.workspaceDirectory);
  const byUrl = new Map<string, Promise<LinkStatus>>();
  for (const { url } of links) if (!byUrl.has(url)) byUrl.set(url, probe(url));
  return { statuses: await Promise.all(links.map(({ url }) => byUrl.get(url)!)) };
}
