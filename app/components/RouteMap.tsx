"use client";
import { useCallback, useRef, useState } from "react";
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

const numberedIcon = (
  num: number,
  opts?: { highlighted?: boolean; reordering?: boolean }
) => {
  const border = opts?.highlighted
    ? "box-shadow:0 0 0 3px #185FA5;"
    : opts?.reordering
      ? "box-shadow:0 0 0 3px #185FA5;opacity:0.7;"
      : "";
  return L.divIcon({
    html: `<div style="background:#000;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;cursor:grab;pointer-events:auto;${border}">${num}</div>`,
    className: "numbered-route-marker",
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
};

function buildPathSegments(
  stops: Stop[]
): { key: string; positions: [number, number][] }[] {
  const segments: { key: string; positions: [number, number][] }[] = [];
  stops.forEach((stop, i) => {
    if (i === 0 || !stop.pathCoordinates?.length) return;
    segments.push({
      key: stop.address,
      positions: stop.pathCoordinates,
    });
  });
  return segments;
}

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

type RouteMapProps = {
  stops: Stop[];
  onReorder?: (fromIndex: number, toIndex: number) => void;
  reorderingStopIndex?: number | null;
  reorderingMessage?: string | null;
};

export default function RouteMap({
  stops,
  onReorder,
  reorderingStopIndex,
  reorderingMessage,
}: RouteMapProps) {
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);
  const lastPathSegmentsRef = useRef<
    { key: string; positions: [number, number][] }[]
  >([]);

  const canReorder = Boolean(onReorder);

  const handleDrag = useCallback(
    (index: number, e: L.LeafletEvent) => {
      const marker = e.target as L.Marker;
      const pos = marker.getLatLng();
      const nearest = findNearestStopIndex(pos.lat, pos.lng, stops, index);
      setDraggingIndex(index);
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
      const toIndex = findNearestStopIndex(pos.lat, pos.lng, stops, index);
      const originalLatLng = L.latLng(stops[index].lat, stops[index].lng);

      setDraggingIndex(null);
      setDropTargetIndex(null);

      if (
        reorderingStopIndex != null ||
        toIndex === null ||
        toIndex === index ||
        !onReorder
      ) {
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
    <div
      style={{
        height: 400,
        width: "100%",
        borderRadius: 12,
        overflow: "hidden",
        marginBottom: 16,
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
        {dropTargetIndex !== null && draggingIndex !== null && (
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
            icon={numberedIcon(i + 1, {
              highlighted: dropTargetIndex === i && draggingIndex !== i,
              reordering: reorderingStopIndex === i,
            })}
            draggable={canReorder}
            eventHandlers={
              canReorder
                ? {
                    dragstart: () => setDraggingIndex(i),
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
                {canReorder && (
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
  );
}
