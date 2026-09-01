/**
 * The model call.
 *
 * Gemini is asked for a value from a JSON schema, not for a reply. Structured
 * output is a constraint the API enforces during decoding: the response cannot
 * be prose because prose does not satisfy the schema. That is the difference
 * between asking a model to stay on topic and making it unable to leave.
 *
 * The prompt still says what the app is, because a well-briefed model picks the
 * right route more often. It is not what makes the rule hold - `parseAction` on
 * the way out is. Prompt for quality; validate for safety.
 */
import type { AskRequest } from "./schema";
import { VIEWS } from "./schema";

const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

const SYSTEM = `You route questions inside TargetX, a KTU academic tracker.

You do not answer questions and you do not state figures. The application
computes every number itself from the student's own records; your only job is
to say WHERE the answer already lives.

Views:
- home:       overall standing, CGPA, what needs attention
- ledger:     this semester's marks, per subject, per component
- attendance: attendance percentage, classes that can still be missed, CIE
              marks earned from attendance, the weekly timetable
- history:    published results from past semesters
- data:       sync with etlab and KTU, import, backup

Choose "subject" when the question names one of the given courses, and set
"view" to where that question is answered - attendance questions to attendance,
mark questions to ledger. Choose "view" when the question is about the student
overall. Choose "none" with reason "off_topic" for anything not about this
student's academic record, "unclear" when the question cannot be understood,
and "no_match" when it is on topic but nothing here answers it.`;

/** Mirrors `Action`. Gemini enforces this during decoding. */
function responseSchema(codes: string[]) {
  return {
    type: "OBJECT",
    properties: {
      kind: { type: "STRING", enum: ["view", "subject", "none"] },
      view: { type: "STRING", enum: [...VIEWS] },
      // An enum of the codes the client actually sent, so an invented course
      // code is not merely rejected later - it cannot be generated. Empty
      // enums are not valid, so a student with no courses gets the field left
      // open and `parseAction` catches anything that comes back in it.
      ...(codes.length > 0 ? { code: { type: "STRING", enum: codes } } : {}),
      reason: { type: "STRING", enum: ["off_topic", "unclear", "no_match"] },
    },
    required: ["kind"],
  };
}

/** Raw parsed JSON from the model, still untrusted. Validate before use. */
export async function route(
  req: AskRequest, apiKey: string, signal: AbortSignal,
): Promise<unknown> {
  const codes = req.subjects.map((s) => s.code);
  const catalogue = req.subjects.map((s) => `${s.code} ${s.name}`).join("\n");

  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{
      role: "user",
      parts: [{ text: `Courses this semester:\n${catalogue}\n\nQuestion: ${req.question}` }],
    }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: responseSchema(codes),
      // Routing is a classification, not a composition. Sampling buys nothing
      // here except a different answer to the same question on a retry.
      temperature: 0,
      maxOutputTokens: 128,
    },
  };

  const res = await fetch(ENDPOINT, {
    method: "POST",
    // The key travels in a header, never in the URL. Query strings end up in
    // proxy logs and error reports; headers are far less likely to.
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) throw new Error(`gemini ${res.status}`);

  const json = await res.json<{
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  }>();

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== "string") throw new Error("gemini: no content");

  // Structured output means this should always parse. "Should" is not a
  // guarantee we get to rely on when the input is a remote service.
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new Error("gemini: unparseable");
  }
}
