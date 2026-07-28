export const QUIET_COLOR_TOKENS = Object.freeze({
  ink: '#48494d',
  graphite: '#5f6064',
  dusk: '#625f69',
  plum: '#6b6570',
  slate: '#68717d',
  denim: '#61717c',
  moss: '#70776f',
  sage: '#68736c',
  clay: '#7a706a',
  taupe: '#746c64',
  smoke: '#8b8b87',
  mist: '#b4b4b1',
});

export const DEFAULT_APPEARANCE = Object.freeze({
  h1: 'plum',
  h2: 'slate',
  h3: 'graphite',
  marker: 'mist',
});

const APPEARANCE_KEYS = Object.freeze(Object.keys(DEFAULT_APPEARANCE));

export function normalizeAppearance(input = {}) {
  const normalized = {};
  for (const key of APPEARANCE_KEYS) {
    const token = input?.[key];
    normalized[key] = Object.hasOwn(QUIET_COLOR_TOKENS, token)
      ? token
      : DEFAULT_APPEARANCE[key];
  }
  return normalized;
}

export function appearanceCssVariables(input = {}) {
  const appearance = normalizeAppearance(input);
  return {
    '--heading-1': QUIET_COLOR_TOKENS[appearance.h1],
    '--heading-2': QUIET_COLOR_TOKENS[appearance.h2],
    '--heading-3': QUIET_COLOR_TOKENS[appearance.h3],
    '--marker': QUIET_COLOR_TOKENS[appearance.marker],
  };
}

export function applyAppearance(target, input = {}) {
  if (!target?.style) return;
  for (const [name, value] of Object.entries(appearanceCssVariables(input))) {
    target.style.setProperty(name, value);
  }
}
