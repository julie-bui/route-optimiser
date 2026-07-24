# Route Optimiser

A Next.js application for planning property-viewing tours in London. Upload brochure PDFs or paste addresses, choose viewing contacts, optimise the visit order, and send viewing requests or schedules by email.

## Features

- Extracts addresses and agency contacts from PDFs with Gemini.
- Geocodes addresses with OpenCage, constrained to Greater London.
- Flags low-confidence address matches for review or manual confirmation.
- Plans tours by public transport, walking, cycling, car, or taxi.
- Displays route maps, transit stops, leg details, and rounded arrival/travel times.
- Sends personalised viewing requests through Resend.
- Downloads or emails an Excel/plain-text tour schedule.

## Setup

Install dependencies:

```bash
npm install
```

Create `.env.local` with the required API credentials:

```bash
GEMINI_API_KEY=
OPENCAGE_API_KEY=
TFL_API_KEY=
LOCATIONIQ_ACCESS_TOKEN=
TOMTOM_API_KEY=
RESEND_API_KEY=
```

Start the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Contact directory

The optional contact search reads from `public/society-contacts.json`. Each entry must include:

```json
{
  "name": "Example Contact",
  "company": "Example Company",
  "email": "contact@example.com"
}
```

## Workflow

1. Upload PDF brochures or paste addresses.
2. Select agency contacts or enter a recipient for manual addresses.
3. Review any geocoding matches that need attention.
4. Set the tour start point, date, time, and travel mode.
5. Review the itinerary, adjust viewing durations, and download or email the schedule.
6. Confirm and send viewing requests.
