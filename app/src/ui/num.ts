/**
 * Figures as the screen will actually print them.
 *
 * Every SGPA and CGPA in this app is rendered with `toFixed(2)`, and any
 * arithmetic DONE on those figures has to agree with what the reader can see.
 * Subtracting the raw floats does not: the stock record showed "must deliver
 * 7.86 SGPA. You are projecting 7.46 — short by 0.41", three numbers on one
 * line where the third contradicts the first two, in the sentence a student is
 * most likely to check on their fingers. Home said 0.40 and the goal bar said
 * 0.41 for the same pair, which is worse - the same question answered twice,
 * differently, one screen apart.
 *
 * `toFixed` and not `Math.round(value * 100) / 100`, which is the same thing
 * until it is not: the two disagree on the doubles that sit a hair either side
 * of a half-cent, and `toFixed` is what the printer uses. Rounding the
 * operands by a rule the printer does not share reintroduces the exact
 * mismatch this exists to remove.
 *
 * Use it on both operands of any subtraction whose result is shown beside
 * them. It is deliberately not a formatter - it returns a number, so the
 * caller still chooses how to print it.
 */
export const show2 = (value: number): number => Number(value.toFixed(2));
