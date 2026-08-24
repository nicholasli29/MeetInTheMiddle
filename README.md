# Meet in the Middle

A group enters where each person is starting from and how far they're willing to travel.
The app works out each person's reachable area, intersects them, and **ranks** the venues
and hotels inside the shared area.

Drawing a shared travel zone is the easy half — other tools already do it, and you're
left staring at a shaded blob still arguing about where inside it to go. The useful half
is deciding which place in that area is actually the best one, and being honest that
"best" depends on what the group cares about.

## Running it

```bash
npm install --prefix app
npm run dev          # http://localhost:5173
```

Create `app/.env.local`:

```
VITE_MAPBOX_TOKEN=pk....   # public token, safe in the client
FSQ_KEY=...                # deliberately not VITE_ prefixed — see "Why there's a proxy"
```

```bash
npm test        # 23 unit tests, no network
npm run test:live   # end-to-end against the real APIs
npm run lint
```

Click the map to add starting points, or press **Load an example** for a worked scenario.

## The scoring model

Three axes, combined with weights the user controls:

| Axis | Meaning | Source |
|---|---|---|
| **Speed** | Shortest average trip across the group | Travel matrix |
| **Fairness** | Smallest gap between the longest and shortest trip | Travel matrix |
| **Agenda** | Density of the chosen activity types within a walk | Place categories |

**Speed and fairness are deliberately separate objectives.** They conflict, and the
conflict is the point: somewhere two people reach in five minutes and a third reaches in
an hour has an excellent average and is a poor answer. Minimising the mean and minimising
the spread are different problems, and which one a group means is theirs to say — hence a
slider rather than a decision made on their behalf.

That difference is visible in the app. With the example loaded, each axis picks a
different winner: speed favours somewhere central with a 58-minute spread, fairness
favours somewhere everyone reaches within about ten minutes of each other, and agenda
favours whichever corner has the densest cluster of what was asked for.

Moving a slider re-ranks from data already fetched — no network call — which is why it
responds immediately.

### Normalisation

Every axis is normalised the same way against the same surviving set, which is what makes
the weights mean what the sliders claim. Mixing an absolute axis with a set-relative one
would make an identical weight move the ranking by very different amounts.

Two guards on that:

- **A floored denominator.** Plain min-max stretches whatever range it is given across
  the full interval, so candidates whose averages differ by twenty seconds would be
  presented as the gap between best and worst.
- **A neutral degenerate case.** When every candidate scores alike on an axis it returns
  0.5, not 0 — because 0 inverts to a full bar and reads as "everything is optimal"
  rather than "nothing to choose between".

Agenda counts matches up to a cap instead of asking whether any exist. A presence check
flatlines: ask for bars, rank bars, and every candidate trivially has one next door.

## Constraints found by testing, not by reading docs

Each of these changed the design, and each came from an actual response:

**Reachable areas cap at 60 minutes.** Anything longer is rejected. This rules out the
weekend-trip framing the idea started from — somewhere everyone can reach within an hour
is not a getaway — so venues lead and hotels are secondary.

**Some category ids return HTTP 200 with an empty result set, permanently.** Two of them
do so in the middle of a dense city, which cannot be true of the data. That is worse than
a rejected id: an error is obvious, whereas an empty result just renders as "nothing
nearby" and never gets questioned. Every id in `categories.ts` was checked against a live
response; the two silent ones are documented and unused.

**The travel matrix imposes three separate limits.** One routing profile per request, so
a group mixing driving and cycling needs a call per mode — sending one would silently
report everyone as driving. At most 25 coordinates per request. And at least two matrix
elements, so a lone source against a lone destination is rejected outright, which happens
in ordinary use as soon as one person picks a mode nobody else is using.

**Searching by a parent category works; matching against one does not.** Places come back
carrying leaf ids, so comparing a response id to a parent id never matches. Results are
attributed to the query that produced them instead.

**Public transport is not available.** Only driving, cycling and walking. See below.

## Why there's a proxy

Not CORS — the places API returns permissive CORS headers and the browser could call it
directly. It's the credential. Vite inlines every `VITE_`-prefixed variable into the
client bundle, so naming the key `VITE_FSQ_KEY` would ship it to every visitor. Leaving
the prefix off keeps it out of the bundle, which also puts it out of the browser's reach —
hence a server-side hop to attach it.

In production this belongs in a serverless function; the client contract doesn't change.

## Architecture

```
src/
  core/          pure logic, no network, no React — all 23 tests live here
    geo.ts       N-way intersection, partial-group fallback, point-in-polygon
    score.ts     normalisation, the three axes, weighting, ranking
    plan.ts      orchestration: area -> candidates -> travel times -> score
  providers/
    isochrone.ts, matrix.ts   reachable areas and travel times
    foursquare.ts             place search and agenda lookups
    categories.ts             verified category ids
  ui/
```

`core/` was built and tested before any UI existed, so the part that makes this more than
a map was proven while the schedule still had slack.

**Request cost per plan:** one reachable area per starting point, one place search, one
matrix call per travel mode, and one call per selected agenda category. Nothing scales
with the number of candidates — agenda proximity is computed geometrically from a single
per-category fetch, rather than a per-candidate lookup that would have forced an arbitrary
"only score the top N" cut-off.

## Decisions worth naming

- **A starting point is not a person.** It's a place, a travel mode and a time budget with
  a label. Nothing in the engine assumes otherwise, so seeding from stations or landmarks
  needs no change to the core.
- **An empty intersection is a designed state, not an error.** Groups frequently have no
  area everyone can reach. Returning nothing would be accurate and useless, so the app
  falls back to the largest subset that does overlap and names who was left out.
- **A starting point must sit inside its own reachable area.** Routing snaps a coordinate
  to the nearest road, so a point dropped in water returns a valid area for somewhere
  else. Those are reported and excluded rather than silently dragging the answer.
- **Nothing is invented.** Where a field isn't available, the interface says so rather
  than substituting an average that would read as real.
- **No seed data on load.** The app opens empty; the example sits behind a button.

## Known gaps

- **Public transport**, which is arguably the most relevant mode for meeting in a city.
  The routing provider has no transit profile at all. Adding it needs a provider offering
  both reachable areas and a travel matrix. The geometry layer is ready for it — transit
  areas are disconnected islands with holes, and point-in-polygon here already handles
  both, with a test for it.
- **A single starting point isn't validated.** The routability check runs when a plan is
  computed, which needs two points, so one pin in the water sits unflagged until a second
  is added. There are no results to be wrong yet, but the feedback is late.
- **Events.** A ticketing provider would add a third result kind, along with a date
  dimension the other two don't have.
- **Budget.** Price is a premium field on the places API and isn't requested; the ranking
  runs entirely on free-tier data.
- **At most 50 results per search**, so dense areas are sampled rather than exhaustive.
- **The proxy is dev-only** and needs a serverless equivalent to deploy.
- Desktop layout only.
