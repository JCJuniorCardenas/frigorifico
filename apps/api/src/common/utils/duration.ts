const UNITS: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

/** Convierte "15m", "7d", "30s", "12h" a milisegundos. */
export function parseDurationMs(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) {
    throw new Error(`Duración inválida: "${value}" (usar por ejemplo 15m, 12h, 7d)`);
  }
  return Number(match[1]) * UNITS[match[2]];
}
