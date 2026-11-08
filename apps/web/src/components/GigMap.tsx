import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { resolveTown, distanceToGig, formatDistance } from '@/lib/kenyaTowns';
import type { GigMatch } from '@/types';

/**
 * Plots matched gigs on a map of Kenya, with the worker's own town marked.
 *
 * Town-level, not street-level. Positions come from the centroid table in
 * lib/kenyaTowns.ts rather than from geocoding each gig, so this cannot tell
 * one side of Nairobi from the other and does not pretend to -- markers are
 * labelled by town and several gigs in one town land on one pin.
 *
 * Leaflet is imported dynamically. It is about 150 kB with its stylesheet and
 * only someone who opens the map needs it, so it stays out of the main
 * bundle, the same treatment pdfjs gets in the CV importer.
 *
 * Tiles are OpenStreetMap, which needs no key. Leaflet renders the required
 * attribution itself and that is deliberately left in place.
 */

interface Props {
  matches: GigMatch[];
  /** The worker's own `location`, free text, used as the origin. */
  workerLocation: string | null | undefined;
}

/** Roughly the bounds of Kenya, for the initial view when nothing is placeable. */
const KENYA_CENTRE: [number, number] = [0.2, 37.8];

export default function GigMap({ matches, workerLocation }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // Gigs that can actually be placed. A remote gig has no town to pin, so it
  // is listed below the map rather than dropped silently.
  const placeable = matches
    .map((match) => ({ match, town: resolveTown(match.gig.location) }))
    .filter((row): row is { match: GigMatch; town: NonNullable<typeof row.town> } =>
      Boolean(row.town) && !row.match.gig.is_remote
    );

  const remote = matches.filter((m) => m.gig.is_remote);
  const unplaceable = matches.filter(
    (m) => !m.gig.is_remote && !resolveTown(m.gig.location)
  );

  useEffect(() => {
    if (!holder.current) return;
    let cancelled = false;
    let map: { remove: () => void } | null = null;

    (async () => {
      try {
        const L = (await import('leaflet')).default;
        await import('leaflet/dist/leaflet.css');
        if (cancelled || !holder.current) return;

        const home = resolveTown(workerLocation);
        const instance = L.map(holder.current, {
          center: home ? [home.lat, home.lon] : KENYA_CENTRE,
          zoom: home ? 8 : 6,
          scrollWheelZoom: false,          // so the page still scrolls over it
        });
        map = instance;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 18,
        }).addTo(instance);

        // Leaflet's default marker icons are loaded from its stylesheet by
        // relative path, which breaks under a bundler. Divs avoid the whole
        // problem and let the markers carry the match score.
        const pin = (label: string, tone: string) =>
          L.divIcon({
            className: '',
            html: `<span class="flex h-7 min-w-7 items-center justify-center rounded-full border-2 border-white px-1.5 text-[11px] font-bold text-white shadow-md" style="background:${tone}">${label}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });

        const points: [number, number][] = [];

        if (home) {
          L.marker([home.lat, home.lon], { icon: pin('You', '#334155') })
            .addTo(instance)
            .bindPopup(`<strong>You</strong><br>${home.name.replace(/\b\w/g, (c) => c.toUpperCase())}`);
          points.push([home.lat, home.lon]);
        }

        for (const { match, town } of placeable) {
          const km = distanceToGig(workerLocation, match.gig);
          const away = formatDistance(km);
          L.marker([town.lat, town.lon], {
            icon: pin(`${match.score_percent}%`, '#b8402a'),
          })
            .addTo(instance)
            .bindPopup(
              `<strong>${match.gig.title}</strong><br>${town.name.replace(/\b\w/g, (c) => c.toUpperCase())}` +
                `${away ? ` &middot; ${away} away` : ''}<br>${match.score_percent}% match`
            );
          points.push([town.lat, town.lon]);
        }

        // Fit to what is actually on the map, so one gig in Mombasa does not
        // leave the view centred on empty ocean.
        if (points.length > 1) {
          instance.fitBounds(points, { padding: [40, 40], maxZoom: 10 });
        }
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();

    return () => {
      cancelled = true;
      map?.remove();
    };
  }, [matches, workerLocation]);

  const home = resolveTown(workerLocation);

  return (
    <div className="mb-5 overflow-hidden rounded-xl border border-slate-200 bg-white">
      {failed ? (
        <p className="px-4 py-8 text-center text-sm text-slate-500">
          The map could not load. Your matches are listed below either way.
        </p>
      ) : (
        <div ref={holder} className="h-72 w-full sm:h-80" aria-label="Map of matched gigs" />
      )}

      <div className="space-y-1 border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        {!home && (
          <p className="flex items-start gap-1.5 text-gold-800">
            <MapPin size={13} className="mt-0.5 shrink-0" aria-hidden />
            Set a town on your profile to see how far each gig is from you.
          </p>
        )}
        {placeable.length > 0 && (
          <p>
            Pins are town centres, so gigs in the same town share one. Distances are
            town-to-town.
          </p>
        )}
        {remote.length > 0 && (
          <p>
            {remote.length} {remote.length === 1 ? 'match is' : 'matches are'} remote and not
            pinned.
          </p>
        )}
        {unplaceable.length > 0 && (
          <p>
            {unplaceable.length} {unplaceable.length === 1 ? 'match has' : 'matches have'} a
            location we could not place on the map.
          </p>
        )}
      </div>
    </div>
  );
}
