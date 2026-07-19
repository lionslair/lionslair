// GitHub's GraphQL resource-cost estimator started rejecting the
// `contributionsCollection` query Platane/snk sends with "Resource limits
// for this query exceeded." once the account's contribution volume got
// high enough. Splitting the request into date-bounded ranges (and
// recursively bisecting any range that still gets rejected) keeps each
// query under the limit, then reassembles a single response in the exact
// shape @snk/github-user-contribution expects so the rest of snk's
// pipeline (route solving, svg rendering) runs unmodified.
const originalFetch = globalThis.fetch;
const GRAPHQL_URL = "https://api.github.com/graphql";

const TOTAL_DAYS = 371; // 53 weeks, matches the grid snk renders
const MAX_SPLIT_DEPTH = 12;

async function fetchChunk(login, token, from, to) {
  const query = `
    query ($login: String!, $from: DateTime!, $to: DateTime!) {
      user(login: $login) {
        contributionsCollection(from: $from, to: $to) {
          contributionCalendar {
            weeks {
              contributionDays {
                contributionCount
                contributionLevel
                weekday
                date
              }
            }
          }
        }
      }
    }
  `;
  const res = await originalFetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      Authorization: `bearer ${token}`,
      "Content-Type": "application/json",
      "User-Agent": "me@platane.me",
    },
    body: JSON.stringify({
      query,
      variables: { login, from: from.toISOString(), to: to.toISOString() },
    }),
  });
  if (!res.ok) throw new Error(await res.text().catch(() => res.statusText));
  const { data, errors } = await res.json();
  if (errors?.[0]) throw new Error(errors[0].message);
  return data.user.contributionsCollection.contributionCalendar.weeks;
}

async function fetchRangeInto(dayMap, login, token, from, to, depth = 0) {
  try {
    const weeks = await fetchChunk(login, token, from, to);
    for (const w of weeks) for (const d of w.contributionDays) dayMap.set(d.date, d);
  } catch (err) {
    const spanDays = (to.getTime() - from.getTime()) / 86400000;
    if (!/Resource limits/i.test(String(err.message)) || spanDays < 2 || depth > MAX_SPLIT_DEPTH) {
      throw err;
    }
    const mid = new Date(from.getTime() + Math.floor((to.getTime() - from.getTime()) / 2));
    console.error(
      `🩹 patch: ${from.toISOString().slice(0, 10)}..${to.toISOString().slice(0, 10)} exceeded resource limits, splitting at ${mid.toISOString().slice(0, 10)}`,
    );
    await fetchRangeInto(dayMap, login, token, from, mid, depth + 1);
    await fetchRangeInto(dayMap, login, token, mid, to, depth + 1);
  }
}

globalThis.fetch = async (url, init) => {
  const isTargetQuery =
    url === GRAPHQL_URL &&
    init?.method === "POST" &&
    typeof init.body === "string" &&
    init.body.includes("contributionsCollection {");

  if (!isTargetQuery) return originalFetch(url, init);

  console.error("🩹 patch: intercepting unbounded contributionsCollection query, fetching bounded + adaptively split");

  const payload = JSON.parse(init.body);
  const login = payload.variables.login;
  const token = init.headers.Authorization.replace(/^bearer /, "");

  const to = new Date();
  const from = new Date(to.getTime() - TOTAL_DAYS * 86400000);

  const dayMap = new Map();
  await fetchRangeInto(dayMap, login, token, from, to);

  const sortedDates = [...dayMap.keys()].sort();
  const firstDate = new Date(sortedDates[0] + "T00:00:00Z");
  const startSunday = new Date(firstDate);
  startSunday.setUTCDate(startSunday.getUTCDate() - startSunday.getUTCDay());
  const lastDate = new Date(sortedDates[sortedDates.length - 1] + "T00:00:00Z");

  const weeks = [];
  const cursor = new Date(startSunday);
  while (cursor <= lastDate) {
    const week = { contributionDays: [] };
    for (let i = 0; i < 7; i++) {
      const dateStr = cursor.toISOString().slice(0, 10);
      week.contributionDays.push(
        dayMap.get(dateStr) ?? {
          contributionCount: 0,
          contributionLevel: "NONE",
          weekday: i,
          date: dateStr,
        },
      );
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    weeks.push(week);
  }

  console.error(`🩹 patch: merged into ${weeks.length} weeks (${dayMap.size} days)`);

  const body = JSON.stringify({
    data: { user: { contributionsCollection: { contributionCalendar: { weeks } } } },
  });
  return new Response(body, { status: 200, headers: { "Content-Type": "application/json" } });
};
