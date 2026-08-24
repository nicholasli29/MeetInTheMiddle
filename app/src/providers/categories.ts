/**
 * Foursquare category ids, each verified against a live response.
 *
 * Two traps worth knowing about:
 *
 * 1. Ids are 24-character hex. The short numeric ids that appear in older material are
 *    rejected outright.
 * 2. Some ids return HTTP 200 with an empty result set indefinitely rather than
 *    erroring. `Restaurant` (4bf58dd8d48988d1c4941735) and the `Nightlife` parent
 *    (4d4b7105d754a06376d81259) both do, in the middle of a dense city. A silently
 *    empty category is worse than a loud failure — it looks like "nothing nearby" — so
 *    neither is used, and dining is served by the Food parent instead.
 */
export interface AgendaCategory {
  key: string
  label: string
  emoji: string
  id: string
}

export const AGENDA_CATEGORIES: AgendaCategory[] = [
  { key: 'dining',    label: 'Dining',     emoji: '🍽️', id: '4d4b7105d754a06374d81259' },
  { key: 'cafes',     label: 'Cafés',      emoji: '☕', id: '4bf58dd8d48988d16d941735' },
  { key: 'bars',      label: 'Bars',       emoji: '🍸', id: '4bf58dd8d48988d116941735' },
  { key: 'nightlife', label: 'Nightlife',  emoji: '🪩', id: '4bf58dd8d48988d11f941735' },
  { key: 'breweries', label: 'Breweries',  emoji: '🍺', id: '50327c8591d4c4b30a586d5d' },
  { key: 'wineries',  label: 'Wineries',   emoji: '🍷', id: '4bf58dd8d48988d14b941735' },
  { key: 'music',     label: 'Live music', emoji: '🎵', id: '4bf58dd8d48988d1e5931735' },
  { key: 'theatre',   label: 'Theatre',    emoji: '🎭', id: '4bf58dd8d48988d137941735' },
  { key: 'museums',   label: 'Museums',    emoji: '🏛️', id: '4bf58dd8d48988d181941735' },
  { key: 'galleries', label: 'Galleries',  emoji: '🖼️', id: '4bf58dd8d48988d1e2931735' },
  { key: 'parks',     label: 'Parks',      emoji: '🌳', id: '4bf58dd8d48988d163941735' },
  { key: 'hiking',    label: 'Hiking',     emoji: '🥾', id: '4bf58dd8d48988d159941735' },
  { key: 'books',     label: 'Bookshops',  emoji: '📚', id: '4bf58dd8d48988d114951735' },
]

export const CATEGORY_BY_KEY = new Map(AGENDA_CATEGORIES.map((c) => [c.key, c]))

/** Hotels have their own tab, so this sits outside the agenda chips. */
export const HOTEL_CATEGORY_ID = '4bf58dd8d48988d1fa931735'

/** Broad, verified categories used when no agenda has been chosen. */
export const DEFAULT_VENUE_CATEGORY_IDS = [
  '4d4b7105d754a06374d81259', // Food
  '4bf58dd8d48988d116941735', // Bar
  '4d4b7104d754a06370d81259', // Arts & Entertainment
  '4d4b7105d754a06377d81259', // Outdoors & Recreation
]
