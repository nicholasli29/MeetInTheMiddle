/** One colour per starting point, shared by its map pin, its area and its panel row. */
export const ORIGIN_COLOURS = [
  '#4aa8ff', '#ff9f4a', '#a78bfa', '#34d399', '#f472b6', '#facc15', '#22d3ee', '#fb7185',
]

/** One colour per scoring axis, shared by the sliders and the contribution bars. */
export const AXIS_COLOURS = {
  speed: '#34d399',
  fairness: '#4aa8ff',
  agenda: '#f59e0b',
} as const

export const AXIS_LABELS = {
  speed: 'Speed',
  fairness: 'Fairness',
  agenda: 'Agenda',
} as const
