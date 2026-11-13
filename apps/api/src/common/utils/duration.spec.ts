import { parseDurationMs } from './duration.js';

describe('parseDurationMs', () => {
  it.each([
    ['30s', 30_000],
    ['15m', 900_000],
    ['12h', 43_200_000],
    ['7d', 604_800_000],
  ])('%s -> %i ms', (input, expected) => {
    expect(parseDurationMs(input)).toBe(expected);
  });

  it.each(['', '15', 'm', '1.5h', '-1d', '10w'])('rechaza "%s"', (input) => {
    expect(() => parseDurationMs(input)).toThrow();
  });
});
