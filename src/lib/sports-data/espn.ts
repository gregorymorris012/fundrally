// Unofficial, undocumented, no-auth ESPN endpoints — no SLA, may change or
// break without notice. No Vercel Marketplace provider exists for sports
// schedule/team data (confirmed via `vercel integration categories` /
// `discover`), so this is a direct fetch rather than a provisioned
// integration. Contained here specifically so that risk stays isolated
// and swappable without touching squares' core logic. Never a hard
// dependency: every caller must treat a failure/empty result as "fall
// back to manual entry," never as a blocking error — this is a demo-mode,
// non-critical convenience only, and manual entry always keeps working.
export type EspnLeague = "nfl" | "college-football" | "nba" | "wnba" | "college-basketball";

const SPORT_BY_LEAGUE: Record<EspnLeague, string> = {
  nfl: "football",
  "college-football": "football",
  nba: "basketball",
  wnba: "basketball",
  "college-basketball": "basketball",
};

// ESPN's own slug for men's college basketball differs from the league
// key we expose here.
const ESPN_LEAGUE_SLUG: Record<EspnLeague, string> = {
  nfl: "nfl",
  "college-football": "college-football",
  nba: "nba",
  wnba: "wnba",
  "college-basketball": "mens-college-basketball",
};

export type EspnEvent = {
  id: string;
  name: string;
  date: string; // ISO
  venue: string | null;
  homeTeam: { name: string; color: string | null };
  awayTeam: { name: string; color: string | null };
};

function toHexColor(color: string | undefined | null): string | null {
  if (!color) return null;
  const trimmed = color.replace(/^#/, "");
  return /^[0-9a-fA-F]{6}$/.test(trimmed) ? `#${trimmed}` : null;
}

const SEARCH_WINDOW_DAYS = 365;
const REQUEST_TIMEOUT_MS = 5000;
const SCOREBOARD_BASE = "https://site.api.espn.com/apis/site/v2/sports";
const COLLEGE_FOOTBALL_REGULAR_SEASON_WEEKS = 15;

type RawScoreboard = {
  events?: Array<{
    id: string;
    name: string;
    date: string;
    competitions?: Array<{
      venue?: { fullName?: string };
      competitors?: Array<{
        homeAway?: string;
        team?: { displayName?: string; color?: string; alternateColor?: string };
      }>;
    }>;
  }>;
};

// ESPN's scoreboard now answers HTTP 400 ("Failed to get events endpoint")
// to the `dates=YYYYMMDD-YYYYMMDD` range form this used to rely on — checked
// September 2026, rejected at every span down to a single day. What it
// still accepts: one day, one month (`dates=YYYYMM`), or a season week.
// College football is the exception to the month form: its date-based
// queries silently cap at 25 events whatever `limit` says (a single
// Saturday alone has 65+), so it's queried by season week plus the
// postseason instead. Both forms are undocumented — if this breaks again,
// callers still fall back to manual entry (see the header comment).
function scoreboardUrls(league: EspnLeague, from: Date): string[] {
  const base = `${SCOREBOARD_BASE}/${SPORT_BY_LEAGUE[league]}/${ESPN_LEAGUE_SLUG[league]}/scoreboard`;

  if (league === "college-football") {
    const weeks = Array.from(
      { length: COLLEGE_FOOTBALL_REGULAR_SEASON_WEEKS },
      (_, i) => `${base}?seasontype=2&week=${i + 1}&groups=80&limit=400`,
    );
    return [...weeks, `${base}?seasontype=3&groups=80&limit=400`];
  }

  // 13 calendar months starting with the current one always covers a full
  // SEARCH_WINDOW_DAYS from any day within the first month.
  return Array.from({ length: 13 }, (_, i) => {
    const month = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth() + i, 1));
    const yyyymm = `${month.getUTCFullYear()}${String(month.getUTCMonth() + 1).padStart(2, "0")}`;
    return `${base}?dates=${yyyymm}&limit=1000`;
  });
}

// Never throws: any network/shape failure yields [] for that one request,
// so a single bad week/month can't take the rest of the results with it.
async function fetchScoreboard(url: string): Promise<EspnEvent[]> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!res.ok) return [];
    const data = (await res.json()) as RawScoreboard;

    const events: EspnEvent[] = [];
    for (const event of data.events ?? []) {
      const competition = event.competitions?.[0];
      const competitors = competition?.competitors ?? [];
      const home = competitors.find((c) => c.homeAway === "home");
      const away = competitors.find((c) => c.homeAway === "away");
      if (!home?.team?.displayName || !away?.team?.displayName) continue;

      events.push({
        id: event.id,
        name: event.name,
        date: event.date,
        venue: competition?.venue?.fullName ?? null,
        homeTeam: {
          name: home.team.displayName,
          color: toHexColor(home.team.color),
        },
        awayTeam: {
          name: away.team.displayName,
          color: toHexColor(away.team.color),
        },
      });
    }
    return events;
  } catch {
    return [];
  }
}

// Games from today through SEARCH_WINDOW_DAYS out, soonest first,
// optionally narrowed by a team/matchup name. Never throws — an empty
// result means "nothing found or ESPN unreachable," and callers fall back
// to manual entry either way.
export async function searchUpcomingEspnEvents(input: {
  league: EspnLeague;
  query?: string;
}): Promise<EspnEvent[]> {
  const now = new Date();
  const windowStart = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const windowEnd = windowStart + SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const batches = await Promise.all(scoreboardUrls(input.league, now).map(fetchScoreboard));

  // Weekly/monthly pages overlap at their edges — dedupe by event id.
  const byId = new Map<string, EspnEvent>();
  for (const event of batches.flat()) {
    const time = Date.parse(event.date);
    if (Number.isNaN(time) || time < windowStart || time > windowEnd) continue;
    byId.set(event.id, event);
  }
  const events = [...byId.values()].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));

  const needle = input.query?.trim().toLowerCase();
  if (!needle) return events;
  return events.filter(
    (e) =>
      e.homeTeam.name.toLowerCase().includes(needle) ||
      e.awayTeam.name.toLowerCase().includes(needle) ||
      e.name.toLowerCase().includes(needle),
  );
}
