const YOCTO_PER_MILLI = 10n ** 21n;

/** NEAR to yoctoNEAR string, to 3 decimal places. */
export const toYocto = (near: number): string =>
  (BigInt(Math.round(near * 1000)) * YOCTO_PER_MILLI).toString();

/** yoctoNEAR string to NEAR, to 3 decimal places. */
export const toNear = (yocto: string): number =>
  Number(BigInt(yocto) / YOCTO_PER_MILLI) / 1000;

export const shortKey = (pk: string): string => pk.slice(0, 12) + "…" + pk.slice(-4);
