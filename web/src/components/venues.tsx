"use client";

import { useState } from "react";
import { fmt } from "@/lib/format";
import type { Place, Venue } from "@/lib/types";
import { AirMap, MAP_ENABLED, venueId } from "./air-map";
import { Card, CardHeader, IndoorIcon, Spinner, StatusIcon, StatusPill } from "./ui";

export type VenuesState = { status: "loading" } | { status: "error"; message: string } |
  { status: "done"; venues: Venue[]; preferIndoor: boolean };

export function Venues({ state, place }: { state: VenuesState; place: Place }) {
  // the venue under the pointer, on the map or in the list, so the other one can point to it too
  const [active, setActive] = useState<string | null>(null);
  const subtitle = state.status === "done" && state.preferIndoor
    ? "Indoor venues first, since the plan scores Medium or worse or rain is likely. Indoor is a guess from the venue name, so check with the operator."
    : "The nearest ActiveSG venues and park facilities within 12 km.";
  return (
    <Card>
      <CardHeader title="Nearby alternatives" subtitle={subtitle} />
      {MAP_ENABLED && (
        <AirMap place={place} venues={state.status === "done" ? state.venues : null} active={active} onActive={setActive} />
      )}
      <div className="border-t border-line">
        {state.status === "loading" && (
          <div className="flex items-center gap-2 px-5 py-4 text-[13px] text-ink-2"><Spinner />Finding venues near you</div>
        )}
        {state.status === "error" && <div className="px-5 py-4 text-[13px] text-ink-2">{state.message}</div>}
        {state.status === "done" && state.venues.length === 0 && (
          <div className="px-5 py-4 text-[13px] text-ink-2">No ActiveSG venues or park facilities within 12 km.</div>
        )}
        {state.status === "done" && state.venues.length > 0 && (
          <ul>
            {state.venues.map((v) => (
              <li key={venueId(v)} onPointerEnter={() => setActive(venueId(v))} onPointerLeave={() => setActive(null)}
                className={`flex items-center justify-between gap-4 border-b border-line px-5 py-2.5 transition-colors last:border-0 ${
                  active === venueId(v) ? "bg-surface-2" : ""}`}>
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{v.name}</div>
                  <div className="truncate text-xs text-ink-2">
                    {fmt(v.distanceKm, 1)} km away, {v.type === "NParks" ? "NParks" : "ActiveSG"}
                    {v.detail ? `, ${v.detail}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 sm:flex-row sm:items-center sm:gap-3">
                  {v.isIndoor ? (
                    <>
                      {v.level && (
                        <span className="inline-flex items-center gap-1 text-xs text-ink-2">
                          <StatusIcon level={v.level} size={12} />{v.level} outdoors
                        </span>
                      )}
                      <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-surface-2 pr-2.5 pl-2 text-[13px] font-medium text-ink ring-1 ring-line">
                        <IndoorIcon />
                        Indoor
                      </span>
                    </>
                  ) : v.level ? <StatusPill level={v.level} size="sm" /> : <span className="text-xs text-ink-2">no forecast</span>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
