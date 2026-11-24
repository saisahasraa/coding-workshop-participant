/**
 * "Tonal" colouring for chips and badges: a tint of the colour behind text in its strong shade.
 * Softer than a filled chip, and readable in both colour schemes.
 *
 * @param {'primary'|'secondary'|'success'|'warning'|'error'|'info'|'default'} color
 * @returns {(theme: object) => object} an `sx` callback
 */
export const tonal = (color) => (theme) => {
  if (color === 'default') {
    return {
      backgroundColor: theme.vars.palette.action.selected,
      color: theme.vars.palette.text.secondary,
      ...theme.applyStyles('dark', { color: theme.vars.palette.text.primary }),
    };
  }
  const tone = theme.vars.palette[color];
  return {
    backgroundColor: `rgba(${tone.mainChannel} / 0.12)`,
    color: tone.dark,
    ...theme.applyStyles('dark', { backgroundColor: `rgba(${tone.mainChannel} / 0.2)`, color: tone.light }),
  };
};

/**
 * Text in a status colour that stays readable on the page background in both colour schemes.
 * @param {'primary'|'secondary'|'success'|'warning'|'error'|'info'} color
 * @returns {(theme: object) => object} an `sx` callback
 */
export const toneText = (color) => (theme) => ({
  color: theme.vars.palette[color].dark,
  ...theme.applyStyles('dark', { color: theme.vars.palette[color].light }),
});
