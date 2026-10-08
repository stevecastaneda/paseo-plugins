export type WorkspaceLink = { label: string; url: string };

/** The URL as people read it: no scheme, no `www.`, no lone trailing slash. */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//i, "").replace(/^www\./i, "").replace(/\/$/, "");
}

// First match wins, so specific services sit above the generic words that often share a name
// with them ("Firestore" is a database before it is Firebase).
const ICON_RULES: readonly (readonly [RegExp, string])[] = [
  [/\b(docs?|documentation|guides?|wiki|readme|handbook)\b/, "BookOpen"],
  [/\b(design|storybook|figma|ui ?kit|styleguide|components?)\b/, "Palette"],
  [/\b(auth|login|sign ?in|accounts?|identity|users?|sso|oauth)\b/, "KeyRound"],
  [/\b(admin|backoffice|cms|console)\b/, "Shield"],
  [/\b(firestore|database|db|postgres(ql)?|mysql|mongo(db)?|redis|sql|supabase|prisma|pgadmin|data)\b/, "Database"],
  [/\b(storage|buckets?|files|s3|uploads?|blobs?|assets|cdn)\b/, "HardDrive"],
  [/\b(api|graphql|graphiql|swagger|openapi|rest|rpc|trpc)\b/, "Braces"],
  [/\b(mail|email|inbox|mailpit|mailhog|smtp)\b/, "Mail"],
  [/\b(logs?|logging|traces?|tracing|sentry|errors?)\b/, "ScrollText"],
  [/\b(metrics|analytics|grafana|monitor(ing)?|stats|status|health|posthog)\b/, "Activity"],
  [/\b(dashboard|overview)\b/, "LayoutDashboard"],
  [/\b(functions?|lambdas?|serverless|edge|webhooks?)\b/, "Zap"],
  [/\b(queues?|jobs?|workers?|cron|tasks?|inngest|temporal)\b/, "Layers"],
  [/\b(firebase|emulators?)\b/, "Flame"],
  [/\b(git|github|gitlab|repo|pr|pull)\b/, "GitBranch"],
  [/\b(ci|builds?|deploys?|deployments?|vercel|netlify|preview|staging)\b/, "Rocket"],
  [/\b(app|web|site|frontend|client|home|localhost)\b/, "AppWindow"],
];

function words(text: string): string {
  // Split camelCase and punctuation into words so `__design` and `adminPanel` still match.
  return text.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().replace(/[^a-z0-9]+/g, " ");
}

function matchIcon(text: string): string | null {
  const haystack = ` ${words(text)} `;
  for (const [pattern, icon] of ICON_RULES) if (pattern.test(haystack)) return icon;
  return null;
}

/** A Lucide icon for the link, guessed from its name first and its URL second. */
export function linkIcon(link: WorkspaceLink): string {
  return matchIcon(link.label) ?? matchIcon(displayUrl(link.url)) ?? "Globe";
}
