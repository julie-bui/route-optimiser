import { NextRequest, NextResponse } from "next/server";

const LONDON_BOUNDS = {
  south: 51.2868,
  west: -0.5103,
  north: 51.6919,
  east: 0.3340,
};

function isWithinLondonBounds(lat: number, lng: number): boolean {
  return (
    lat >= LONDON_BOUNDS.south &&
    lat <= LONDON_BOUNDS.north &&
    lng >= LONDON_BOUNDS.west &&
    lng <= LONDON_BOUNDS.east
  );
}

function extractQueryHouseNumber(address: string): string | null {
  const match = address.match(/^(\d+[a-zA-Z]?(?:\s*[-–]\s*\d+[a-zA-Z]?)?)/);
  return match ? match[1].toLowerCase().replace(/\s+/g, "") : null;
}

function normalizeHouseNumber(value: string): string {
  return value.toLowerCase().replace(/\s+/g, "").replace(/–/g, "-");
}

async function geocodeWithGoogle(queryAddress: string) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    queryAddress
  )}&key=${process.env.GOOGLE_MAPS_API_KEY}&components=country:GB&bounds=51.2868,-0.5103|51.6919,0.3340`;

  const res = await fetch(url);
  const data = await res.json();

  if (data.status !== "OK" || !data.results[0]) {
    return {
      lat: null,
      lng: null,
      resolvedFormatted: null,
      resolvedHouseNumber: null,
      locationType: null,
    };
  }

  const result = data.results[0];
  const houseNumberComponent = result.address_components?.find((c: any) =>
    c.types.includes("street_number")
  );

  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    resolvedFormatted: result.formatted_address || null,
    resolvedHouseNumber: houseNumberComponent?.long_name || null,
    locationType: result.geometry.location_type || null,
  };
}

export async function POST(req: NextRequest) {
  const { addresses } = await req.json();

  const results = await Promise.all(
    addresses.map(async (address: string) => {
      const addressLower = address.toLowerCase();
      const mentionsLondon = addressLower.includes("london");

      const addressForSearch = mentionsLondon ? address : `${address}, London`;

      const searchAddress = addressForSearch.toLowerCase().includes("uk") || addressForSearch.toLowerCase().includes("united kingdom")
        ? addressForSearch
        : `${addressForSearch}, UK`;

      try {
        const attempt = await geocodeWithGoogle(searchAddress);

        console.log(
          `Geocode for "${address}": resolved=${attempt.resolvedFormatted}, locationType=${attempt.locationType}, houseNumber=${attempt.resolvedHouseNumber}`
        );

        if (attempt.lat === null || attempt.lng === null) {
          return {
            address,
            lat: null,
            lng: null,
            verified: false,
            error: "Geocoding failed: no match found",
          };
        }

        const queryHouseNumber = extractQueryHouseNumber(address);
        const normalizedQuery = queryHouseNumber
          ? normalizeHouseNumber(queryHouseNumber)
          : null;
        const normalizedResolved = attempt.resolvedHouseNumber
          ? normalizeHouseNumber(attempt.resolvedHouseNumber)
          : null;

        const houseNumberMatches =
          !normalizedQuery ||
          !normalizedResolved ||
          normalizedQuery === normalizedResolved ||
          normalizedResolved.includes(normalizedQuery) ||
          normalizedQuery.includes(normalizedResolved);

        const isRooftop = attempt.locationType === "ROOFTOP";
        const withinBounds = isWithinLondonBounds(attempt.lat, attempt.lng);
        const verified = houseNumberMatches && withinBounds && (isRooftop || attempt.locationType === "RANGE_INTERPOLATED");

        console.log(`Bounds check for "${address}": lat=${attempt.lat}, lng=${attempt.lng}, withinBounds=${withinBounds}`);

        return {
          address,
          lat: attempt.lat,
          lng: attempt.lng,
          resolvedFormatted: attempt.resolvedFormatted,
          verified,
          error: null,
        };
      } catch (err: any) {
        return {
          address,
          lat: null,
          lng: null,
          verified: false,
          error: "Geocoding request failed",
        };
      }
    })
  );

  return NextResponse.json({ results });
}
