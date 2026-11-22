// Pure leaderboard maths, kept apart so it is easy to test and to change once the rules are settled.
// Input rows look like { user_id, first_at, last_at, leaves } for one season.

// Board 1, "this season": who caught their first leaf earliest, first to last.
export function rankFirstCatch(rows) {
  return [...rows].sort((a, b) => new Date(a.first_at) - new Date(b.first_at));
}

// Board 2, "leaf wealth": most leaves this season. Tie: whoever reached that count first.
export function rankWealth(rows) {
  return [...rows].sort((a, b) => b.leaves - a.leaves || new Date(a.last_at) - new Date(b.last_at));
}

// Board 3, "all time". GUESS at the formula, waiting on Rebeca:
//   season points = players that season - your place + 1   (1st of 10 gets 10, last gets 1)
//   score         = sum over seasons of (2 x season points + leaves caught that season)
// so a place on the season board counts double compared with one leaf.
export function allTimeScores(seasonRows) {
  const totals = new Map();
  for (const rows of seasonRows.values()) {
    const ranked = rankFirstCatch(rows);
    ranked.forEach((r, i) => {
      const t = totals.get(r.user_id) || { user_id: r.user_id, score: 0, season_points: 0, leaves: 0, seasons: 0 };
      t.season_points += ranked.length - i;
      t.leaves += Number(r.leaves);
      t.seasons += 1;
      t.score = 2 * t.season_points + t.leaves;
      totals.set(r.user_id, t);
    });
  }
  return [...totals.values()].sort((a, b) => b.score - a.score || b.season_points - a.season_points);
}

// Places are renumbered inside the chosen filter (everyone / friends / a group), so a friends
// board always starts at #1. All-time scores stay global and are only filtered.
export function withPlaces(ranked, keep) {
  return ranked.filter((r) => !keep || keep.has(r.user_id)).map((r, i) => ({ ...r, place: i + 1 }));
}
