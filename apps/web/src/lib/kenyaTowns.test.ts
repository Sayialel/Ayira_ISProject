import { describe, it, expect } from 'vitest';
import {
  TOWN_POINTS,
  resolveTown,
  haversineKm,
  distanceToGig,
  formatDistance,
} from './kenyaTowns';

describe('TOWN_POINTS', () => {
  it('places every town inside Kenya', () => {
    // Kenya spans roughly 5°N to 4.7°S and 33.9°E to 41.9°E. A sign error on
    // a latitude is the easy mistake here and would put a town in Ethiopia.
    for (const [name, p] of Object.entries(TOWN_POINTS)) {
      expect(p.lat, `${name} latitude`).toBeGreaterThan(-5);
      expect(p.lat, `${name} latitude`).toBeLessThan(5.5);
      expect(p.lon, `${name} longitude`).toBeGreaterThan(33.5);
      expect(p.lon, `${name} longitude`).toBeLessThan(42);
    }
  });

  it('keeps the two spellings of Murang\'a on the same spot', () => {
    expect(TOWN_POINTS.muranga).toEqual(TOWN_POINTS["murang'a"]);
  });
});

describe('resolveTown', () => {
  it('finds a bare town name', () => {
    expect(resolveTown('Nairobi')?.name).toBe('nairobi');
  });

  it('finds a town inside a longer string', () => {
    // The real shapes of this free-text column.
    expect(resolveTown('Nairobi, Kenya')?.name).toBe('nairobi');
    expect(resolveTown('Westlands, Nairobi')?.name).toBe('nairobi');
    expect(resolveTown('nairobi cbd')?.name).toBe('nairobi');
  });

  it('prefers the longest match', () => {
    // "Athi River" contains no shorter town, but this guards the rule that
    // stops a two-word town losing to a one-word one elsewhere in the text.
    expect(resolveTown('Athi River, Machakos')?.name).toBe('athi river');
  });

  it('returns null for an unknown or empty location', () => {
    expect(resolveTown('Lodwar')).toBeNull();
    expect(resolveTown('')).toBeNull();
    expect(resolveTown(null)).toBeNull();
    expect(resolveTown(undefined)).toBeNull();
  });
});

describe('haversineKm', () => {
  it('is zero for the same point', () => {
    expect(haversineKm(TOWN_POINTS.nairobi, TOWN_POINTS.nairobi)).toBeCloseTo(0, 5);
  });

  it('matches known distances', () => {
    // Nairobi to Thika is about 40 km, Nairobi to Mombasa about 490 km —
    // the two cases the engine's geography docstring calls out as needing to
    // stop scoring the same.
    expect(haversineKm(TOWN_POINTS.nairobi, TOWN_POINTS.thika)).toBeGreaterThan(25);
    expect(haversineKm(TOWN_POINTS.nairobi, TOWN_POINTS.thika)).toBeLessThan(45);

    const toMombasa = haversineKm(TOWN_POINTS.nairobi, TOWN_POINTS.mombasa);
    expect(toMombasa).toBeGreaterThan(430);
    expect(toMombasa).toBeLessThan(500);
  });

  it('is symmetric', () => {
    const a = haversineKm(TOWN_POINTS.kisumu, TOWN_POINTS.garissa);
    const b = haversineKm(TOWN_POINTS.garissa, TOWN_POINTS.kisumu);
    expect(a).toBeCloseTo(b, 6);
  });
});

describe('distanceToGig', () => {
  it('is zero for a remote gig, whatever the locations say', () => {
    // Reachable from anywhere, which is what the number is expressing.
    expect(distanceToGig('Nairobi', { location: 'Mombasa', is_remote: true })).toBe(0);
    expect(distanceToGig(null, { location: null, is_remote: true })).toBe(0);
  });

  it('measures between two known towns', () => {
    const km = distanceToGig('Nairobi', { location: 'Thika', is_remote: false });
    expect(km).not.toBeNull();
    expect(km!).toBeGreaterThan(25);
  });

  it('is null when either end cannot be placed', () => {
    expect(distanceToGig('Lodwar', { location: 'Nairobi', is_remote: false })).toBeNull();
    expect(distanceToGig('Nairobi', { location: 'Lodwar', is_remote: false })).toBeNull();
    expect(distanceToGig(null, { location: 'Nairobi', is_remote: false })).toBeNull();
  });
});

describe('formatDistance', () => {
  it('reads naturally at each scale', () => {
    expect(formatDistance(0)).toBe('in your town');
    expect(formatDistance(0.4)).toBe('in your town');
    expect(formatDistance(4.25)).toBe('4.3 km');
    expect(formatDistance(39.7)).toBe('40 km');
    expect(formatDistance(489.6)).toBe('490 km');
  });

  it('passes null through', () => {
    expect(formatDistance(null)).toBeNull();
  });
});
