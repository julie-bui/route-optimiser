"use client";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
} from "react-leaflet";
import "leaflet/dist/leaflet.css";
import L from "leaflet";

const numberedIcon = (num: number) =>
  L.divIcon({
    html: `<div style="background:#000;color:#fff;border-radius:50%;width:26px;height:26px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:600;">${num}</div>`,
    className: "",
    iconSize: [26, 26],
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

export default function RouteMap({ stops }: { stops: Stop[] }) {
  if (!stops || stops.length === 0) return null;

  const center: [number, number] = [stops[0].lat, stops[0].lng];
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
      <MapContainer
        center={center}
        zoom={13}
        style={{ height: "100%", width: "100%" }}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution="&copy; OpenStreetMap contributors"
        />
        {stops.map((stop, i) => {
          if (
            i === 0 ||
            !stop.pathCoordinates ||
            stop.pathCoordinates.length === 0
          ) {
            return null;
          }

          return (
            <Polyline
              key={`path-${i}`}
              positions={stop.pathCoordinates}
              pathOptions={{ color: "#185FA5", weight: 4 }}
            />
          );
        })}
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
        {stops.map((stop, i) => (
          <Marker
            key={i}
            position={[stop.lat, stop.lng]}
            icon={numberedIcon(i + 1)}
          >
            <Popup>{stop.address}</Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  );
}
