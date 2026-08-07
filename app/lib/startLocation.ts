import type { PropertyPoint } from "@/app/lib/journey";

// Coordinates obtained by geocoding "31-35 Beak Street, London, W1F 9SZ, UK" through
// this project's own Google Geocoding API (same endpoint/key as app/lib/geocode.ts).
// Result: ROOFTOP location_type, exact house-number match ("31-35"), within the
// Greater London bounds already used for property verification. Verified 2026-08-07.
// (Google's formatted_address for this rooftop match returns postcode "W1F 9SX" -
// a common minor discrepancy between Google's postcode data and Royal Mail's for
// buildings that span more than one postcode; the address below keeps the postcode
// as given. The lat/lng are the verified rooftop match for the street address itself.)
export const SPACEPOINT_OFFICE = {
  label: "Spacepoint office",
  address: "31-35 Beak Street, London, W1F 9SZ",
  lat: 51.5123647,
  lng: -0.1377907,
} as const;

export type StartLocation =
  | { type: "property"; propertyIndex: number }
  | { type: "office"; address: string; lat: number; lng: number }
  | { type: "custom"; address: string; lat: number; lng: number };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function validateExternalCoordinates(
  lat: unknown,
  lng: unknown
): string | null {
  if (!isFiniteNumber(lat) || !isFiniteNumber(lng)) {
    return "Starting point coordinates must be valid numbers.";
  }
  if (lat < -90 || lat > 90) {
    return "Starting point latitude is out of range.";
  }
  if (lng < -180 || lng > 180) {
    return "Starting point longitude is out of range.";
  }
  return null;
}

// Returns the PropertyPoint to use as the route origin when the start is external
// (office/custom), or null when the start is one of the uploaded properties.
export function externalStartPoint(startLocation: any): PropertyPoint | null {
  if (!startLocation || typeof startLocation !== "object") return null;
  if (startLocation.type === "office" || startLocation.type === "custom") {
    return {
      address: startLocation.address,
      lat: startLocation.lat,
      lng: startLocation.lng,
    };
  }
  return null;
}

// Validates a raw startLocation payload from the client. `propertiesLength` bounds
// a "property" type's propertyIndex; pass it whenever the caller has the properties
// array available (omit it - e.g. in recalculate-schedule - to skip that bounds check).
export function validateStartLocationPayload(
  startLocation: any,
  propertiesLength: number = Infinity
): string | null {
  if (startLocation == null || typeof startLocation !== "object") {
    return "A starting point is required.";
  }

  if (startLocation.type === "property") {
    const { propertyIndex } = startLocation;
    if (
      typeof propertyIndex !== "number" ||
      !Number.isInteger(propertyIndex) ||
      propertyIndex < 0 ||
      propertyIndex >= propertiesLength
    ) {
      return "Selected starting property is invalid.";
    }
    return null;
  }

  if (startLocation.type === "office" || startLocation.type === "custom") {
    if (
      typeof startLocation.address !== "string" ||
      startLocation.address.trim().length === 0
    ) {
      return "Starting point address is missing.";
    }
    return validateExternalCoordinates(startLocation.lat, startLocation.lng);
  }

  return "Unrecognised starting point type.";
}
