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

async function geocodeWithPlacesAPI(queryAddress: string) {
  const url = `https://places.googleapis.com/v1/places:searchText`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY || "",
      "X-Goog-FieldMask": "places.formattedAddress,places.location,places.addressComponents",
    },
    body: JSON.stringify({
      textQuery: queryAddress,
      locationBias: {
        rectangle: {
          low: { latitude: LONDON_BOUNDS.south, longitude: LONDON_BOUNDS.west },
          high: { latitude: LONDON_BOUNDS.north, longitude: LONDON_BOUNDS.east },
        },
      },
    }),
  });

  const data = await res.json();
  const place = data.places?.[0];

  if (!place) {
    return { lat: null, lng: null, resolvedFormatted: null, resolvedHouseNumber: null };
  }

  const houseNumberComponent = place.addressComponents?.find((c: any) =>
    c.types?.includes("street_number")
  );

  return {
    lat: place.location?.latitude ?? null,
    lng: place.location?.longitude ?? null,
    resolvedFormatted: place.formattedAddress || null,
    resolvedHouseNumber: houseNumberComponent?.longText || null,
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
        let attempt = await geocodeWithGoogle(searchAddress);

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

        let isRooftop = attempt.locationType === "ROOFTOP";
        let withinBounds = isWithinLondonBounds(attempt.lat, attempt.lng);
        let usedPlacesFallback = false;

        if (!attempt.resolvedHouseNumber && attempt.lat) {
          const placesResult = await geocodeWithPlacesAPI(searchAddress);

          if (placesResult.lat && placesResult.resolvedHouseNumber) {
            const placesWithinBounds = isWithinLondonBounds(
              placesResult.lat,
              placesResult.lng!
            );
            const placesHouseNumberMatches =
              !queryHouseNumber ||
              normalizeHouseNumber(placesResult.resolvedHouseNumber) ===
                normalizeHouseNumber(queryHouseNumber);

            if (placesWithinBounds && placesHouseNumberMatches) {
              attempt = {
                lat: placesResult.lat,
                lng: placesResult.lng,
                resolvedFormatted: placesResult.resolvedFormatted,
                resolvedHouseNumber: placesResult.resolvedHouseNumber,
                locationType: "ROOFTOP",
              };
              isRooftop = true;
              withinBounds = true;
              usedPlacesFallback = true;
            }
          }
        }

        const finalHouseNumberMatches =
          !queryHouseNumber ||
          !attempt.resolvedHouseNumber ||
          normalizeHouseNumber(queryHouseNumber) ===
            normalizeHouseNumber(attempt.resolvedHouseNumber) ||
          normalizeHouseNumber(attempt.resolvedHouseNumber).includes(
            normalizeHouseNumber(queryHouseNumber)
          ) ||
          normalizeHouseNumber(queryHouseNumber).includes(
            normalizeHouseNumber(attempt.resolvedHouseNumber)
          );

        const verified =
          finalHouseNumberMatches &&
          withinBounds &&
          (isRooftop || attempt.locationType === "RANGE_INTERPOLATED");

        console.log(
          `Bounds check for "${address}": lat=${attempt.lat}, lng=${attempt.lng}, withinBounds=${withinBounds}, usedPlacesFallback=${usedPlacesFallback}`
        );

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
