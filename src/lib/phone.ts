// Kenyan mobile numbers. Safaricom's API wants 2547XXXXXXXX (or 2541XXXXXXXX), but people type
// 0712 345 678, +254 712 345 678, 712345678 ... We normalise on the way in.

/** Returns "2547XXXXXXXX" / "2541XXXXXXXX", or null if it isn't a valid Kenyan mobile number. */
export function normalizeKenyanPhone(input: string): string | null {
  const digits = input.replace(/[\s\-().]/g, "").replace(/^\+/, "");
  let national: string;
  if (/^254\d{9}$/.test(digits)) national = digits.slice(3);
  else if (/^0\d{9}$/.test(digits)) national = digits.slice(1);
  else if (/^\d{9}$/.test(digits)) national = digits;
  else return null;
  // Mobile ranges start with 7 (Safaricom, Airtel, Telkom...) or 1 (the newer 01 range).
  return /^[17]\d{8}$/.test(national) ? `254${national}` : null;
}

/** "254712345678" -> "0712 345 678" (what people recognise). */
export function formatKenyanPhone(normalized: string): string {
  const n = `0${normalized.slice(3)}`;
  return `${n.slice(0, 4)} ${n.slice(4, 7)} ${n.slice(7)}`;
}

/** "254712345678" -> "07•• ••• 678": enough to recognise your own number, not to harvest it. */
export function maskKenyanPhone(normalized: string): string {
  const n = `0${normalized.slice(3)}`;
  return `${n.slice(0, 2)}•• ••• ${n.slice(7)}`;
}
