import { GoogleGenerativeAI, SchemaType } from "@google/generative-ai";
import { NextRequest, NextResponse } from "next/server";

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

const schema = {
  type: SchemaType.OBJECT,
  properties: {
    address: { type: SchemaType.STRING, nullable: true },
    agentName: { type: SchemaType.STRING, nullable: true },
    agentEmail: { type: SchemaType.STRING, nullable: true },
    agentPhone: { type: SchemaType.STRING, nullable: true },
  },
  required: ["address", "agentName", "agentEmail", "agentPhone"],
};

const model = genAI.getGenerativeModel({
  model: "gemini-flash-latest",
  generationConfig: {
    responseMimeType: "application/json",
    responseSchema: schema,
  },
});

const BATCH_SIZE = 2;
const DELAY_BETWEEN_BATCHES_MS = 8000;
const MAX_RETRIES = 3;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function extractOne(file: File, attempt = 1): Promise<any> {
  try {
    const buffer = Buffer.from(await file.arrayBuffer());
    const base64 = buffer.toString("base64");

    const result = await model.generateContent([
      { inlineData: { mimeType: "application/pdf", data: base64 } },
      {
        text: "Extract the property address and the listing agent's contact details (name, email, phone) from this brochure. If a field genuinely isn't present, return null for it — do not guess or invent values.",
      },
    ]);

    const parsed = JSON.parse(result.response.text());

    return {
      sourcePdfName: file.name,
      address: parsed.address,
      agentName: parsed.agentName,
      agentEmail: parsed.agentEmail,
      agentPhone: parsed.agentPhone,
      needsReview: !parsed.address || !parsed.agentEmail,
      error: null,
    };
  } catch (err: any) {
    const is429 = err?.status === 429 || err?.message?.includes("429");

    if (is429 && attempt <= MAX_RETRIES) {
      const backoff = 10000 * attempt;
      await sleep(backoff);
      return extractOne(file, attempt + 1);
    }

    return {
      sourcePdfName: file.name,
      address: null,
      agentName: null,
      agentEmail: null,
      agentPhone: null,
      needsReview: true,
      error: is429
        ? "Rate limit hit repeatedly — try again in a minute, or enter manually."
        : "Extraction failed — enter details manually.",
    };
  }
}

export async function POST(req: NextRequest) {
  const formData = await req.formData();
  const files = formData.getAll("files") as File[];

  const results: any[] = [];

  for (let i = 0; i < files.length; i += BATCH_SIZE) {
    const batch = files.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map((f) => extractOne(f)));
    results.push(...batchResults);

    if (i + BATCH_SIZE < files.length) {
      await sleep(DELAY_BETWEEN_BATCHES_MS);
    }
  }

  return NextResponse.json({ results });
}