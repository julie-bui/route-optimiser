const LONDON_BOUNDS = {
  south: 51.2868,
  west: -0.5103,
  north: 51.6919,
  east: 0.3340,
};

export type GeocodePurpose = "property" | "start-location";

export type GeocodeResult = {
  address: string;
  lat: number | null;
  lng: number | null;
  resolvedFormatted: string | null;
  verified: boolean;
  // True when `verified` was granted via the postcode-centroid path below rather
  // than building-level (rooftop) precision - lets callers avoid presenting a
  // postcode centroid as if it were an exact building.
  isPostcodeCentroid?: boolean;
  error: string | null;
};

// A complete UK postcode (outward + inward code), e.g. "SW1A 1AA" or "W1F 9SZ".
// Deliberately anchored/whitespace-normalized so an incomplete fragment like
// "W1F 9S" - or a postcode embedded in a longer address - does not match.
const COMPLETE_UK_POSTCODE_REGEX = /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/;

function normalizePostcode(value: string): string {
  return value.trim().toUpperCase().replace(/\s+/g, "");
}

export function isCompleteUkPostcode(value: string): boolean {
  return COMPLETE_UK_POSTCODE_REGEX.test(normalizePostcode(value));
}

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

function resultSeemsToMatchStreet(
  queryAddress: string,
  resolvedFormatted: string | null
): boolean {
  if (!resolvedFormatted) return false;

  const ignoredTokens = new Set([
    "the",
    "and",
    "road",
    "street",
    "lane",
    "avenue",
    "place",
    "square",
    "court",
    "way",
    "drive",
    "close",
    "london",
    "uk",
    "united",
    "kingdom",
    "england",
  ]);
  const tokensFor = (value: string) =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter(
        (token) =>
          token.length > 2 &&
          !ignoredTokens.has(token) &&
          !/^[a-z]{1,2}\d[a-z\d]?$/.test(token) &&
          !/^\d+$/.test(token)
      );

  const queryTokens = tokensFor(queryAddress);
  const resolvedTokens = new Set(tokensFor(resolvedFormatted));
  return queryTokens.some((token) => resolvedTokens.has(token));
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
      resolvedPostcode: null,
      locationType: null,
    };
  }

  const result = data.results[0];
  const houseNumberComponent = result.address_components?.find((c: any) =>
    c.types.includes("street_number")
  );
  const postcodeComponent = result.address_components?.find((c: any) =>
    c.types.includes("postal_code")
  );

  return {
    lat: result.geometry.location.lat,
    lng: result.geometry.location.lng,
    resolvedFormatted: result.formatted_address || null,
    resolvedHouseNumber: houseNumberComponent?.long_name || null,
    resolvedPostcode: postcodeComponent?.long_name || null,
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

export async function geocodeLondonAddress(
  address: string,
  options?: { purpose?: GeocodePurpose }
): Promise<GeocodeResult> {
  const purpose = options?.purpose ?? "property";
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
        resolvedFormatted: null,
        verified: false,
        error: "Geocoding failed: no match found",
      };
    }

    // A complete postcode used as a start-location query is verified against
    // Google's postcode-centroid match - it deliberately does not require
    // building-level (rooftop) precision. Property addresses always require the
    // strict rooftop/house-number verification below, regardless of this branch.
    if (purpose === "start-location" && isCompleteUkPostcode(address)) {
      const withinBounds = isWithinLondonBounds(attempt.lat, attempt.lng);
      const requestedPostcode = normalizePostcode(address);
      const resolvedPostcode = attempt.resolvedPostcode
        ? normalizePostcode(attempt.resolvedPostcode)
        : null;
      const postcodeMatches = resolvedPostcode === requestedPostcode;
      const verified = withinBounds && postcodeMatches;

      console.log(
        `Postcode-only geocode for "${address}": resolvedPostcode=${attempt.resolvedPostcode}, withinBounds=${withinBounds}, postcodeMatches=${postcodeMatches}`
      );

      return {
        address,
        lat: attempt.lat,
        lng: attempt.lng,
        resolvedFormatted: attempt.resolvedFormatted,
        verified,
        isPostcodeCentroid: verified,
        error: verified
          ? null
          : "Google could not confirm this exact postcode - try a fuller address.",
      };
    }

    const queryHouseNumber = extractQueryHouseNumber(address);

    let isRooftop = attempt.locationType === "ROOFTOP";
    let withinBounds = isWithinLondonBounds(attempt.lat, attempt.lng);
    let usedPlacesFallback = false;

    if (!attempt.resolvedHouseNumber && attempt.lat) {
      let placesResult: {
        lat: number | null;
        lng: number | null;
        resolvedFormatted: string | null;
        resolvedHouseNumber: string | null;
      };
      try {
        placesResult = await geocodeWithPlacesAPI(searchAddress);
        console.log(
          `Places API result for "${address}":`,
          JSON.stringify(placesResult)
        );
      } catch (placesErr: any) {
        console.log(`Places API ERROR for "${address}":`, placesErr.message);
        placesResult = {
          lat: null,
          lng: null,
          resolvedFormatted: null,
          resolvedHouseNumber: null,
        };
      }

      if (placesResult.lat && placesResult.resolvedHouseNumber) {
        const placesWithinBounds = isWithinLondonBounds(
          placesResult.lat,
          placesResult.lng!
        );
        // A query with no house number at all (e.g. a bare place/street name)
        // gives Places nothing genuine to confirm against - upgrading to ROOFTOP
        // in that case would bless whichever nearby building Places happened to
        // return, purely because it shares a street-name token with the query.
        const placesHouseNumberMatches =
          queryHouseNumber !== null &&
          normalizeHouseNumber(placesResult.resolvedHouseNumber) ===
            normalizeHouseNumber(queryHouseNumber);
        const placesMatchesStreet = resultSeemsToMatchStreet(
          searchAddress,
          placesResult.resolvedFormatted
        );

        if (
          placesWithinBounds &&
          placesHouseNumberMatches &&
          placesMatchesStreet
        ) {
          attempt = {
            lat: placesResult.lat,
            lng: placesResult.lng,
            resolvedFormatted: placesResult.resolvedFormatted,
            resolvedHouseNumber: placesResult.resolvedHouseNumber,
            resolvedPostcode: attempt.resolvedPostcode,
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

    const exactHouseNumberMatch =
      queryHouseNumber &&
      attempt.resolvedHouseNumber &&
      normalizeHouseNumber(queryHouseNumber) ===
        normalizeHouseNumber(attempt.resolvedHouseNumber);

    const acceptableLocationType =
      isRooftop ||
      attempt.locationType === "RANGE_INTERPOLATED" ||
      (attempt.locationType === "GEOMETRIC_CENTER" && exactHouseNumberMatch);

    const verified =
      finalHouseNumberMatches && withinBounds && !!acceptableLocationType;

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
      resolvedFormatted: null,
      verified: false,
      error: "Geocoding request failed",
    };
  }
}
