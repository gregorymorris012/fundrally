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

const SEARCH_WINDOW_DAYS = 30;

function toEspnDate(date: Date): string {
  return date.toISOString().slice(0, 10).replace(/-/g, "");
}

// ESPN's scoreboard endpoint defaults to just "this week," not a season-
// wide search — too narrow for picking a game to run a squares pool
// against, which is typically set up weeks ahead. Explicitly requests a
// ~month-out date range instead (`dates=YYYYMMDD-YYYYMMDD`, an
// undocumented but consistently-supported param across ESPN's site-api
// sports) with a high `limit` so a busy week doesn't get truncated.
// Never throws: any network/shape failure returns [] so callers can
// always fall back to manual entry without a broken page.
export async function searchUpcomingEspnEvents(input: {
  league: EspnLeague;
  query?: string;
}): Promise<EspnEvent[]> {
  const sport = SPORT_BY_LEAGUE[input.league];
  const leagueSlug = ESPN_LEAGUE_SLUG[input.league];
  const today = new Date();
  const windowEnd = new Date(today.getTime() + SEARCH_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const dates = `${toEspnDate(today)}-${toEspnDate(windowEnd)}`;
  const url = `https://site.api.espn.com/apis/site/v2/sports/${sport}/${leagueSlug}/scoreboard?dates=${dates}&limit=1000`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return [];
    const data = (await res.json()) as {
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

    if (!input.query) return events;
    const needle = input.query.trim().toLowerCase();
    if (!needle) return events;
    return events.filter(
      (e) =>
        e.homeTeam.name.toLowerCase().includes(needle) ||
        e.awayTeam.name.toLowerCase().includes(needle) ||
        e.name.toLowerCase().includes(needle),
    );
  } catch {
    return [];
  }
}
