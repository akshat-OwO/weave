const durationUnits = [
  { label: "d", seconds: 86_400 },
  { label: "h", seconds: 3600 },
  { label: "m", seconds: 60 },
  { label: "s", seconds: 1 },
] as const;

export const formatRemainingTtl = (
  expiresAt: number,
  currentTimeMillis: number
): string => {
  let remainingSeconds = Math.ceil((expiresAt - currentTimeMillis) / 1000);
  if (remainingSeconds <= 0) {
    return "expired";
  }

  const parts: string[] = [];
  for (const unit of durationUnits) {
    const value = Math.floor(remainingSeconds / unit.seconds);
    if (value > 0) {
      parts.push(`${value}${unit.label}`);
      remainingSeconds %= unit.seconds;
    }
  }

  return parts.slice(0, 2).join(" ");
};
