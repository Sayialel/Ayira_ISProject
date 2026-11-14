/**
 * Coordinates for the towns the matcher knows, and the distance between them.
 *
 * Town centroids, not per-gig geocoding. The engine's geography module says
 * why the coordinates were not there before: a full distance model "would
 * have needed coordinates the schema does not store and a geocoding service
 * the project does not have". Geocoding every gig would mean a new column, a
 * backfill of the existing catalogue, an external service with a key and a
 * rate limit, and a plan for the Kenyan place names geocoders get wrong.
 *
 * Centroids buy most of the value for none of that. "Is this gig in my town,
 * the next one, or 490 km away" is the question a worker is actually asking,
 * and a town centroid answers it. What it cannot do is tell one side of
 * Nairobi from the other, so the UI says "near Nairobi", never a street.
 *
 * This list mirrors TOWN_COUNTY in apps/ai-engine/app/services/kenya_geography.py.
 * A town here that the engine does not know would be placed on the map and
 * then ignored by the location term in the score, which would be worse than
 * leaving it off.
 */

export interface TownPoint {
  lat: number;
  lon: number;
  county: string;
}

/** Keyed lower-case, as the engine keys its own map. */
export const TOWN_POINTS: Record<string, TownPoint> = {
  nairobi: { lat: -1.2864, lon: 36.8172, county: 'Nairobi' },

  // Kiambu — the commuter belt north of Nairobi
  thika: { lat: -1.0333, lon: 37.0693, county: 'Kiambu' },
  ruiru: { lat: -1.15, lon: 36.9667, county: 'Kiambu' },
  kikuyu: { lat: -1.246, lon: 36.663, county: 'Kiambu' },
  limuru: { lat: -1.112, lon: 36.642, county: 'Kiambu' },
  juja: { lat: -1.1036, lon: 37.0144, county: 'Kiambu' },

  // Machakos
  machakos: { lat: -1.5177, lon: 37.2634, county: 'Machakos' },
  'athi river': { lat: -1.4564, lon: 36.9783, county: 'Machakos' },

  // Nakuru
  nakuru: { lat: -0.3031, lon: 36.08, county: 'Nakuru' },
  naivasha: { lat: -0.7167, lon: 36.4333, county: 'Nakuru' },

  // Coast
  mombasa: { lat: -4.0435, lon: 39.6682, county: 'Mombasa' },
  malindi: { lat: -3.2175, lon: 40.1191, county: 'Kilifi' },
  kilifi: { lat: -3.6305, lon: 39.8499, county: 'Kilifi' },

  // Nyanza
  kisumu: { lat: -0.0917, lon: 34.768, county: 'Kisumu' },
  ahero: { lat: -0.1833, lon: 34.9167, county: 'Kisumu' },
  kisii: { lat: -0.6817, lon: 34.768, county: 'Kisii' },
  'homa bay': { lat: -0.5273, lon: 34.4571, county: 'Homa Bay' },

  // Rift Valley
  eldoret: { lat: 0.5143, lon: 35.2698, county: 'Uasin Gishu' },
  kitale: { lat: 1.0157, lon: 35.0062, county: 'Trans Nzoia' },
  kericho: { lat: -0.3692, lon: 35.2861, county: 'Kericho' },

  // Western
  bungoma: { lat: 0.5635, lon: 34.5606, county: 'Bungoma' },
  kakamega: { lat: 0.2827, lon: 34.7519, county: 'Kakamega' },
  mumias: { lat: 0.3339, lon: 34.4869, county: 'Kakamega' },
  vihiga: { lat: 0.05, lon: 34.7233, county: 'Vihiga' },

  // Central
  nyeri: { lat: -0.4169, lon: 36.951, county: 'Nyeri' },
  karatina: { lat: -0.4833, lon: 37.1333, county: 'Nyeri' },
  // Both spellings are in use and both are in the engine's map.
  "murang'a": { lat: -0.7167, lon: 37.15, county: "Murang'a" },
  muranga: { lat: -0.7167, lon: 37.15, county: "Murang'a" },
  nanyuki: { lat: 0.0167, lon: 37.0725, county: 'Laikipia' },
  nyahururu: { lat: 0.0333, lon: 36.3667, county: 'Laikipia' },

  // Eastern and North Eastern
  meru: { lat: 0.0463, lon: 37.6559, county: 'Meru' },
  embu: { lat: -0.531, lon: 37.4575, county: 'Embu' },
  kitui: { lat: -1.3667, lon: 38.0167, county: 'Kitui' },
  garissa: { lat: -0.4532, lon: 39.6461, county: 'Garissa' },
};

/**
 * Finds a town in a free-text location field.
 *
 * `location` is a free string -- "Nairobi", "Nairobi, Kenya", "Westlands,
 * Nairobi", "nairobi cbd" -- so an exact lookup finds almost nothing. The
 * longest matching name wins, so "Athi River" is not read as a miss when a
 * shorter name also appears in the string.
 */
export function resolveTown(location: string | null | undefined): (TownPoint & { name: string }) | null {
  if (!location) return null;
  const haystack = location.toLowerCase();

  let best: (TownPoint & { name: string }) | null = null;
  for (const [name, point] of Object.entries(TOWN_POINTS)) {
    if (!haystack.includes(name)) continue;
    if (!best || name.length > best.name.length) best = { ...point, name };
  }
  return best;
}

const EARTH_RADIUS_KM = 6371;

/** Great-circle distance in kilometres. */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * How far a gig is from a worker, or null when either end is unplaceable.
 *
 * A remote gig is 0 away by definition rather than unknown: it is reachable
 * from anywhere, which is the thing the number is being used to express.
 */
export function distanceToGig(
  workerLocation: string | null | undefined,
  gig: { location: string | null; is_remote: boolean }
): number | null {
  if (gig.is_remote) return 0;
  const from = resolveTown(workerLocation);
  const to = resolveTown(gig.location);
  if (!from || !to) return null;
  return haversineKm(from, to);
}

/** Where a gig's pin goes, and which piece of data put it there. */
export interface GigPlacement {
  point: TownPoint & { name: string };
  /**
   * 'gig' -- the gig's own location field.
   * 'employer' -- the gig gave none we recognise, so the town on the posting
   * employer's profile is used: the best available answer to "where was this
   * posted from", and labelled as such on the map.
   */
  source: 'gig' | 'employer';
}

/**
 * Places a gig on the map, remote or not.
 *
 * A remote gig still has somewhere it was posted from, and showing it there
 * (with a remote marker) is more useful than leaving it off the map: the
 * worker sees who is hiring near them even for work they can do from home.
 * Returns null only when neither the gig nor its employer names a known town.
 */
export function placeGig(gig: {
  location: string | null;
  employer?: { location?: string | null } | null;
}): GigPlacement | null {
  const own = resolveTown(gig.location);
  if (own) return { point: own, source: 'gig' };
  const employer = resolveTown(gig.employer?.location);
  if (employer) return { point: employer, source: 'employer' };
  return null;
}

/** Short human form: "in your town", "12 km", "490 km". */
export function formatDistance(km: number | null): string | null {
  if (km === null) return null;
  if (km < 1) return 'in your town';
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}
