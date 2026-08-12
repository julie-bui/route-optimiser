"use client";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

function sqDist(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const dlat = lat1 - lat2;
  const dlng = lng1 - lng2;
  return dlat * dlat + dlng * dlng;
}

function findNearestStopIndex(
  lat: number,
  lng: number,
  stops: Stop[],
  excludeIndex: number
): number | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

  let nearest: number | null = null;
  let minDist = Infinity;
  stops.forEach((stop, i) => {
    if (i === excludeIndex) return;
    if (!Number.isFinite(stop.lat) || !Number.isFinite(stop.lng)) return;
    const d = sqDist(lat, lng, stop.lat, stop.lng);
    if (d < minDist) {
      minDist = d;
      nearest = i;
    }
  });
  return nearest;
}

function findRouteNeighborIndex(
  from: number,
  direction: -1 | 1,
  excludeIndex: number,
  length: number
): number | null {
  let i = from + direction;
  while (i >= 0 && i < length) {
    if (i !== excludeIndex) return i;
    i += direction;
  }
  return null;
}

function midpoint(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): { lat: number; lng: number } {
  return { lat: (lat1 + lat2) / 2, lng: (lng1 + lng2) / 2 };
}

function determineInsertAfter(
  dropLat: number,
  dropLng: number,
  nearestIndex: number,
  fromIndex: number,
  stops: Stop[]
): boolean {
  const prevIndex = findRouteNeighborIndex(
    nearestIndex,
    -1,
    fromIndex,
    stops.length
  );
  const nextIndex = findRouteNeighborIndex(
    nearestIndex,
    1,
    fromIndex,
    stops.length
  );

  if (prevIndex !== null && nextIndex !== null) {
    const prev = stops[prevIndex];
    const nearest = stops[nearestIndex];
    const next = stops[nextIndex];
    const midBefore = midpoint(prev.lat, prev.lng, nearest.lat, nearest.lng);
    const midAfter = midpoint(nearest.lat, nearest.lng, next.lat, next.lng);
    const distToMidBefore = sqDist(dropLat, dropLng, midBefore.lat, midBefore.lng);
    const distToMidAfter = sqDist(dropLat, dropLng, midAfter.lat, midAfter.lng);
    if (distToMidBefore !== distToMidAfter) {
      return distToMidAfter < distToMidBefore;
    }
    const distToPrev = sqDist(dropLat, dropLng, prev.lat, prev.lng);
    const distToNext = sqDist(dropLat, dropLng, next.lat, next.lng);
    return distToNext < distToPrev;
  }

  if (prevIndex !== null && nextIndex === null) {
    const prev = stops[prevIndex];
    const nearest = stops[nearestIndex];
    const mid = midpoint(prev.lat, prev.lng, nearest.lat, nearest.lng);
    const distToMid = sqDist(dropLat, dropLng, mid.lat, mid.lng);
    const distToNearest = sqDist(dropLat, dropLng, nearest.lat, nearest.lng);
    return distToNearest <= distToMid;
  }

  if (prevIndex === null && nextIndex !== null) {
    const nearest = stops[nearestIndex];
    const next = stops[nextIndex];
    const mid = midpoint(nearest.lat, nearest.lng, next.lat, next.lng);
    const distToMid = sqDist(dropLat, dropLng, mid.lat, mid.lng);
    const distToNearest = sqDist(dropLat, dropLng, nearest.lat, nearest.lng);
    return distToMid <= distToNearest;
  }

  return fromIndex <= nearestIndex;
}

function computeReorderTargetIndex(
  dropLat: number,
  dropLng: number,
  fromIndex: number,
  stops: Stop[]
): number | null {
  const nearestIndex = findNearestStopIndex(
    dropLat,
    dropLng,
    stops,
    fromIndex
  );
  if (nearestIndex === null) return null;

  const insertAfter = determineInsertAfter(
    dropLat,
    dropLng,
    nearestIndex,
    fromIndex,
    stops
  );
  const rawToIndex = insertAfter ? nearestIndex + 1 : nearestIndex;
  let toIndex = fromIndex < rawToIndex ? rawToIndex - 1 : rawToIndex;

  // Splice adjustment can cancel adjacent moves (e.g. B onto C → 1,1).
  if (toIndex === fromIndex) {
    if (nearestIndex === fromIndex + 1) {
      toIndex = fromIndex + 1;
    } else if (nearestIndex === fromIndex - 1) {
      toIndex = fromIndex - 1;
    }
  }

  return toIndex;
}

const numberedIcon = (num: number, opts?: { reordering?: boolean }) => {
  const border = opts?.reordering
    ? "box-shadow:0 0 0 3px #185FA5;opacity:0.7;"
    : "";
  return L.divIcon({
    html: `<div style="background:#000;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;cursor:grab;${border}">${num}</div>`,
    className: "numbered-route-marker",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
};

function buildPathSegments(
  stops: Stop[]
): { key: string; positions: [number, number][] }[] {
  const segments: { key: string; positions: [number, number][] }[] = [];
  stops.forEach((stop) => {
    // stops[0] is always the start of the actual tour and therefore has no
    // incoming path, regardless of the selected starting point - so
    // pathCoordinates is empty for it and naturally skipped here.
    if (!stop.pathCoordinates?.length) return;
    segments.push({
      key: stop.address,
      positions: stop.pathCoordinates,
    });
  });
  return segments;
}

const startMarkerIcon = L.divIcon({
  html: `<div style="background:#185FA5;color:#fff;border-radius:14px;padding:3px 10px;font-size:11px;font-weight:600;white-space:nowrap;box-shadow:0 1px 4px rgba(0,0,0,0.35);">Start</div>`,
  className: "start-route-marker",
  iconSize: [46, 22],
  iconAnchor: [23, 11],
});

type Leg = {
  mode: string;
  fromStation?: string | null;
  toStation?: string | null;
  fromStationCoords?: [number, number] | null;
  toStationCoords?: [number, number] | null;
};

type Stop = {
  address: string;
  lat: number;
  lng: number;
  pathCoordinates?: [number, number][];
  legs?: Leg[];
};

type ExternalStartLocation = {
  address: string;
  lat: number;
  lng: number;
};

type RouteMapProps = {
  stops: Stop[];
  startLocation?: ExternalStartLocation | null;
  onReorder?: (fromIndex: number, toIndex: number) => void;
  reorderingStopIndex?: number | null;
  reorderingMessage?: string | null;
};

export default function RouteMap({
  stops,
  startLocation,
  onReorder,
  reorderingStopIndex,
  reorderingMessage,
}: RouteMapProps) {
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const [blockedDragMessage, setBlockedDragMessage] = useState<string | null>(
    null
  );
  const draggingIndexRef = useRef<number | null>(null);
  const blockedDragTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null
  );
  const lastPathSegmentsRef = useRef<
    { key: string; positions: [number, number][] }[]
  >([]);

  const canReorder = Boolean(onReorder);
  const canDrag = canReorder && reorderingStopIndex == null;

  const markerIcons = useMemo(
    () =>
      stops.map((_, i) =>
        numberedIcon(i + 1, {
          reordering: reorderingStopIndex === i,
        })
      ),
    [stops, reorderingStopIndex]
  );

  const handleDrag = useCallback(
    (index: number, e: L.LeafletEvent) => {
      const marker = e.target as L.Marker;
      const pos = marker.getLatLng();
      const nearest = findNearestStopIndex(pos.lat, pos.lng, stops, index);
      setDropTargetIndex(
        nearest !== null && nearest !== index ? nearest : null
      );
    },
    [stops]
  );

  const handleDragEnd = useCallback(
    (index: number, e: L.LeafletEvent) => {
      const marker = e.target as L.Marker;
      const pos = marker.getLatLng();
      const toIndex = computeReorderTargetIndex(
        pos.lat,
        pos.lng,
        index,
        stops
      );
      const originalLatLng = L.latLng(stops[index].lat, stops[index].lng);

      draggingIndexRef.current = null;
      marker.setZIndexOffset(index * 10);
      setDropTargetIndex(null);

      if (reorderingStopIndex != null) {
        marker.setLatLng(originalLatLng);
        if (blockedDragTimeoutRef.current) {
          clearTimeout(blockedDragTimeoutRef.current);
        }
        setBlockedDragMessage("Route is updating — try again in a moment");
        blockedDragTimeoutRef.current = setTimeout(() => {
          setBlockedDragMessage(null);
          blockedDragTimeoutRef.current = null;
        }, 3000);
        return;
      }

      if (toIndex === null || toIndex === index || !onReorder) {
        marker.setLatLng(originalLatLng);
        return;
      }

      onReorder(index, toIndex);
    },
    [stops, onReorder, reorderingStopIndex]
  );

  if (!stops || stops.length === 0) return null;

  const incomingSegments = buildPathSegments(stops);
  if (incomingSegments.length > 0) {
    lastPathSegmentsRef.current = incomingSegments;
  }
  const pathSegments = lastPathSegmentsRef.current;

  const center: [number, number] = [stops[0].lat, stops[0].lng];
  const showReorderingLabel =
    reorderingStopIndex != null &&
    reorderingStopIndex >= 0 &&
    reorderingStopIndex < stops.length;
  const stationMarkers: { coords: [number, number]; name: string }[] = [];

  stops.forEach((stop) => {
    (stop.legs || []).forEach((leg) => {
      if (leg.mode !== "walking") {
        if (leg.fromStationCoords && leg.fromStation) {
          stationMarkers.push({
            coords: leg.fromStationCoords,
            name: leg.fromStation,
          });
        }
        if (leg.toStationCoords && leg.toStation) {
          stationMarkers.push({
            coords: leg.toStationCoords,
            name: leg.toStation,
          });
        }
      }
    });
  });

  return (
    <div style={{ marginBottom: 16 }}>
      {blockedDragMessage && (
        <p
          style={{
            margin: "0 0 8px",
            padding: "8px 12px",
            fontSize: 13,
            color: "#185FA5",
            background: "#E8F1FA",
            borderRadius: 8,
          }}
        >
          {blockedDragMessage}
        </p>
      )}
      <div
        style={{
          height: 400,
          width: "100%",
          borderRadius: 12,
          overflow: "hidden",
        }}
      >
      <style>{`
        .route-reordering-tooltip.leaflet-tooltip {
          pointer-events: none;
          background: #185FA5;
          color: #fff;
          border: none;
          font-size: 12px;
          font-weight: 500;
          padding: 4px 10px;
          border-radius: 6px;
          box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
          white-space: nowrap;
        }
        .route-reordering-tooltip.leaflet-tooltip-top::before {
          border-top-color: #185FA5;
        }
        .numbered-route-marker {
          background: transparent !important;
          border: none !important;
        }
      `}</style>
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {pathSegments.map((segment) => (
          <Polyline
            key={`path-${segment.key}`}
            positions={segment.positions}
            pathOptions={{ color: "#185FA5", weight: 4 }}
          />
        ))}
        {stationMarkers.map((marker, i) => (
          <CircleMarker
            key={`station-${i}`}
            center={marker.coords}
            radius={5}
            pathOptions={{
              color: "#185FA5",
              fillColor: "#fff",
              fillOpacity: 1,
              weight: 2,
            }}
          >
            <Popup>{marker.name}</Popup>
          </CircleMarker>
        ))}
        {startLocation && (
          <Marker
            position={[startLocation.lat, startLocation.lng]}
            icon={startMarkerIcon}
            zIndexOffset={2000}
            draggable={false}
          >
            <Popup>
              <div style={{ minWidth: 150 }}>
                <p style={{ fontSize: 13, margin: "0 0 4px", fontWeight: 500 }}>
                  {startLocation.address}
                </p>
                <p style={{ fontSize: 11, color: "#666", margin: 0 }}>
                  Starting point
                </p>
              </div>
            </Popup>
          </Marker>
        )}
        {dropTargetIndex !== null && (
          <CircleMarker
            key={`drop-ring-${dropTargetIndex}`}
            center={[stops[dropTargetIndex].lat, stops[dropTargetIndex].lng]}
            radius={18}
            pathOptions={{
              color: "#185FA5",
              fillColor: "#185FA5",
              fillOpacity: 0.15,
              weight: 3,
            }}
          />
        )}
        {stops.map((stop, i) => (
          <Marker
            key={stop.address}
            position={[stop.lat, stop.lng]}
            icon={markerIcons[i]}
            zIndexOffset={i * 10}
            draggable={canDrag}
            eventHandlers={
              canDrag
                ? {
                    dragstart: (e) => {
                      draggingIndexRef.current = i;
                      (e.target as L.Marker).setZIndexOffset(1000);
                    },
                    drag: (e) => handleDrag(i, e),
                    dragend: (e) => handleDragEnd(i, e),
                  }
                : undefined
            }
          >
            {showReorderingLabel && reorderingStopIndex === i && (
              <Tooltip
                permanent
                direction="top"
                offset={[0, -18]}
                opacity={1}
                interactive={false}
                className="route-reordering-tooltip"
              >
                {reorderingMessage || "Recalculating…"}
              </Tooltip>
            )}
            <Popup>
              <div style={{ minWidth: 150 }}>
                <p
                  style={{
                    fontSize: 13,
                    margin: "0 0 4px",
                    fontWeight: 500,
                  }}
                >
                  {stop.address}
                </p>
                {canDrag && (
                  <p style={{ fontSize: 11, color: "#666", margin: 0 }}>
                    Drag pin to reorder
                  </p>
                )}
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
      </div>
    </div>
  );
}
