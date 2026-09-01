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

/**
 * The routing model.
 *
 * `flash-lite` because this is a classification with a fixed output schema and
 * five possible destinations - the cheapest model that can read a course list
 * is the right one, and a larger model buys nothing a JSON enum has already
 * decided.
 *
 * The floating alias rather than a pinned version, which is the opposite of the
 * usual advice and is deliberate. `gemini-2.0-flash` was pinned here and Google
 * retired it; the endpoint began returning 404 and every question in the app
 * failed. A pinned version's failure mode is total and arrives without warning.
 * The alias's failure mode is that the model behind it changes - and with
 * temperature 0, a schema the API enforces during decoding, and `parseAction`
 * rejecting anything outside it, there is very little for a change to break.
 */
const ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-lite-latest:generateContent";

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

What TargetX holds, so that "we do not have that" and "that is not our subject"
are told apart. It has: this semester's marks per component, attendance counts
and percentages, the CIE marks attendance is worth under KTU Regulations 2024
R 7.5.ii, the weekly timetable, published SGPA and credits for past semesters,
and a CGPA target. It does NOT have: fee or hostel records, exam hall tickets,
seating, question papers, syllabus content, faculty contact details, or anything
about another student. A question about the first list is "no_match" at worst.
A question about the second is on the subject of college and still "off_topic",
because there is no screen here that could ever answer it.

Choose "subject" when the question names one of the given courses, and set
"view" to where that question is answered - attendance questions to attendance,
mark questions to ledger. Choose "view" when the question is about the student
overall, and "data" when it is about where the numbers come from, syncing,
importing a grade card, backup, or whether a password is stored. Choose "none"
with reason "off_topic" for anything not about this student's academic record,
"unclear" when the question cannot be understood, and "no_match" when it is on
topic but nothing here answers it.`;

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
