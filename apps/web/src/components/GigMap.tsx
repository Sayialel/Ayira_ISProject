import { useEffect, useRef, useState } from 'react';
import { MapPin, Wifi } from 'lucide-react';
import { resolveTown, distanceToGig, formatDistance, placeGig } from '@/lib/kenyaTowns';
import type { GigPlacement } from '@/lib/kenyaTowns';
import type { GigMatch } from '@/types';

/**
 * Plots matched gigs on a map of Kenya, with the worker's own town marked.
 *
 * Every gig that can be placed is placed, remote ones included. A remote gig
 * is pinned where it was posted from -- its own location, or failing that the
 * employer's town -- with a wifi marker, because it can be done from anywhere
 * and the pin says where the employer is, not where the work happens.
 *
 * Town-level, not street-level. Positions come from the centroid table in
 * lib/kenyaTowns.ts rather than from geocoding each gig, so this cannot tell
 * one side of Nairobi from the other and does not pretend to. Gigs in the
 * same town share one marker, which lists them all.
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

/** Roughly the middle of Kenya, for the initial view and unlocated remote gigs. */
const KENYA_CENTRE: [number, number] = [0.2, 37.8];

const ON_SITE_TONE = '#b8402a';
const REMOTE_TONE = '#42567b';

// A remote marker sits a little east of the town centre, so a town with both
// kinds of gig shows two markers side by side rather than one hiding the other.
const REMOTE_OFFSET_LON = 0.06;

/** lucide's wifi glyph, inlined because Leaflet markers are plain HTML. */
const WIFI_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" ' +
  'stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/>' +
  '<path d="M8.5 16.429a5 5 0 0 1 7 0"/></svg>';

/** Gig titles and towns are user-written and go into popup HTML. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const titleCase = (name: string) => name.replace(/\b\w/g, (c) => c.toUpperCase());

interface MarkerGroup {
  key: string;
  lat: number;
  lon: number;
  remote: boolean;
  /** Null for the group of remote gigs that name no place at all. */
  town: string | null;
  items: { match: GigMatch; placement: GigPlacement | null }[];
}

export default function GigMap({ matches, workerLocation }: Props) {
  const holder = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // One marker per (town, remote or not). Gigs that cannot be placed at all
  // are either grouped (remote: they can be done from anywhere, so one
  // "location not given" marker is honest) or listed under the map (on-site:
  // there is nowhere truthful to put them).
  const groups = new Map<string, MarkerGroup>();
  const unlocatedRemote: GigMatch[] = [];
  const unplaceable: GigMatch[] = [];

  for (const match of matches) {
    const placement = placeGig(match.gig);
    const remote = match.gig.is_remote;

    if (!placement) {
      if (remote) unlocatedRemote.push(match);
      else unplaceable.push(match);
      continue;
    }

    const key = `${placement.point.name}|${remote ? 'remote' : 'onsite'}`;
    const existing = groups.get(key);
    if (existing) {
      existing.items.push({ match, placement });
    } else {
      groups.set(key, {
        key,
        lat: placement.point.lat,
        lon: placement.point.lon + (remote ? REMOTE_OFFSET_LON : 0),
        remote,
        town: placement.point.name,
        items: [{ match, placement }],
      });
    }
  }

  if (unlocatedRemote.length > 0) {
    groups.set('unlocated|remote', {
      key: 'unlocated|remote',
      lat: KENYA_CENTRE[0],
      lon: KENYA_CENTRE[1],
      remote: true,
      town: null,
      items: unlocatedRemote.map((match) => ({ match, placement: null })),
    });
  }

  const markerGroups = [...groups.values()];
  const remoteCount = matches.filter((m) => m.gig.is_remote).length;
  const pinnedCount = matches.length - unplaceable.length;
  const fromEmployer = markerGroups.some((g) =>
    g.items.some((item) => item.placement?.source === 'employer')
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
          scrollWheelZoom: false, // so the page still scrolls over it
        });
        map = instance;

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; OpenStreetMap contributors',
          maxZoom: 18,
        }).addTo(instance);

        // Leaflet's default marker icons are loaded from its stylesheet by
        // relative path, which breaks under a bundler. Divs avoid the whole
        // problem and let the markers carry the match score.
        const pin = (inner: string, tone: string, title: string) =>
          L.divIcon({
            className: '',
            html:
              `<span title="${escapeHtml(title)}" class="flex h-7 min-w-7 items-center justify-center gap-1 ` +
              `rounded-full border-2 border-white px-1.5 text-[11px] font-bold text-white shadow-md" ` +
              `style="background:${tone}">${inner}</span>`,
            iconSize: [28, 28],
            iconAnchor: [14, 14],
          });

        const points: [number, number][] = [];

        if (home) {
          L.marker([home.lat, home.lon], { icon: pin('You', '#334155', 'Your town') })
            .addTo(instance)
            .bindPopup(`<strong>You</strong><br>${escapeHtml(titleCase(home.name))}`);
          points.push([home.lat, home.lon]);
        }

        for (const group of markerGroups) {
          const best = Math.max(...group.items.map((item) => item.match.score_percent));
          const count = group.items.length;
          const label = count === 1 ? `${best}%` : `${count}`;
          const inner = group.remote ? `${WIFI_SVG}<span>${label}</span>` : label;
          const place = group.town ? titleCase(group.town) : null;

          const heading = group.remote
            ? place
              ? `Remote gig${count === 1 ? '' : 's'} posted from ${escapeHtml(place)}`
              : `Remote gig${count === 1 ? '' : 's'} with no posted location`
            : `${escapeHtml(place ?? '')}`;

          const rows = group.items
            .map(({ match, placement }) => {
              const away = group.remote ? null : formatDistance(distanceToGig(workerLocation, match.gig));
              const viaEmployer =
                placement?.source === 'employer' ? ' <em>(employer&rsquo;s town)</em>' : '';
              return (
                `<li style="margin-top:4px"><strong>${escapeHtml(match.gig.title)}</strong>` +
                `<br>${match.score_percent}% match${away ? ` &middot; ${away} away` : ''}${viaEmployer}</li>`
              );
            })
            .join('');

          const note = group.remote
            ? '<br><span style="color:#64748b">Can be done from anywhere.</span>'
            : '';

          L.marker([group.lat, group.lon], {
            icon: pin(
              inner,
              group.remote ? REMOTE_TONE : ON_SITE_TONE,
              group.remote ? `Remote, ${label}` : `${place ?? ''}, ${label}`
            ),
          })
            .addTo(instance)
            .bindPopup(
              `<strong>${heading}</strong>${note}<ul style="margin:4px 0 0;padding-left:16px">${rows}</ul>`
            );
          points.push([group.lat, group.lon]);
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
    // markerGroups is derived from matches, so matches is the real dependency.
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
        {matches.length > 0 && (
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {pinnedCount} of {matches.length} {matches.length === 1 ? 'match' : 'matches'} on the map.
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: ON_SITE_TONE }} />
              On-site
            </span>
            {remoteCount > 0 && (
              <span className="inline-flex items-center gap-1">
                <Wifi size={12} style={{ color: REMOTE_TONE }} aria-hidden />
                Remote, pinned where it was posted
              </span>
            )}
          </p>
        )}
        <p>
          Pins are town centres, so gigs in the same town share one. Distances are town-to-town.
          {fromEmployer && ' Where a gig gave no town, the employer’s town is used.'}
        </p>
        {unlocatedRemote.length > 0 && (
          <p>
            {unlocatedRemote.length} remote {unlocatedRemote.length === 1 ? 'gig gives' : 'gigs give'} no
            posted location, so {unlocatedRemote.length === 1 ? 'it is' : 'they are'} grouped on one
            marker in central Kenya.
          </p>
        )}
        {unplaceable.length > 0 && (
          <p>
            {unplaceable.length} on-site {unplaceable.length === 1 ? 'match has' : 'matches have'} a
            location we could not place on the map.
          </p>
        )}
      </div>
    </div>
  );
}
