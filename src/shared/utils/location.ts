/** "City, Country", skipping empty parts. */
export const composeLocation = (
  city?: string | null,
  country?: string | null,
): string => [city?.trim(), country?.trim()].filter(Boolean).join(", ");

/**
 * Splits a stored profile location into its city and the display value.
 * `country` is the source of truth; a stored location is "City, Country", but legacy
 * rows may carry a different country than the `country` column, so only the city is kept.
 */
export const resolveProfileLocation = (
  location?: string | null,
  country?: string | null,
): { city: string; location: string | null } => {
  const stored = location?.trim() ?? "";
  const countryName = country?.trim() ?? "";
  const comma = stored.lastIndexOf(",");
  const city =
    !stored || stored === countryName
      ? ""
      : comma === -1
        ? stored
        : stored.slice(0, comma).trim();

  if (!countryName) return { city, location: stored || null };
  return { city, location: composeLocation(city, countryName) };
};
