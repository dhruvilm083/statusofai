const API = "https://generativelanguage.googleapis.com/v1beta";
const headers = () => ({ "Content-Type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY });

let model = process.env.GEMINI_MODEL || "gemini-flash-latest";

// If the configured model isn't available to this key, pick the newest flash model it can use.
async function discoverModel() {
  const res = await fetch(`${API}/models?pageSize=200`, { headers: headers() });
  if (!res.ok) return null;
  const { models = [] } = await res.json();
  const names = models
    .filter((m) => (m.supportedGenerationMethods || []).includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .filter((n) => /flash/.test(n) && !/image|tts|audio|live|thinking|embed/.test(n))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  return names[0] || null;
}

async function generate(prompt) {
  return fetch(`${API}/models/${model}:generateContent`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0 },
    }),
  });
}

async function gemini(prompt) {
  let res = await generate(prompt);
  if (res.status === 404) {
    const found = await discoverModel();
    if (found && found !== model) {
      model = found;
      res = await generate(prompt);
    }
  }
  if (!res.ok) throw new Error(`Gemini error ${res.status} (${model}): ${await res.text()}`);
  const data = await res.json();
  return (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
}

module.exports = async (req, res) => {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  if (!process.env.GEMINI_API_KEY) return res.status(500).json({ error: "GEMINI_API_KEY is not set" });

  const task = String((req.body && req.body.task) || "").trim().slice(0, 300);
  if (!task) return res.status(400).json({ error: "Type something first" });

  try {
    const answer = await gemini(
      `Can AI currently (today) do the following: "${task}"? Respond very simply with exactly "Yes." or "No." and nothing else.`
    );
    if (/^yes/i.test(answer)) return res.json({ can: true });

    const yearText = await gemini(
      `AI cannot currently do this: "${task}". In what year might AI be able to do it? Respond with only a single four-digit year and nothing else. If AI will probably never be able to do it, respond with only the word "never".`
    );
    const year = /never/i.test(yearText) ? "never" : (yearText.match(/\d{4}/) || ["someday"])[0];
    return res.json({ can: false, year });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: "Couldn't reach Gemini, try again" });
  }
};
