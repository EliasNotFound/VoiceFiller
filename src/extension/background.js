const ENDPOINT = "https://ai4a11y.lovable.app/api/public/gemini/v1beta/models/gemini-3.8-flash:generateContent";
const AI_TIMEOUT_MS = 120000;
const requests = new Map();

async function startOnTab(tabId) {
  try {
    await chrome.scripting.executeScript({ target: { tabId }, files: ["content.js"] });
    await chrome.tabs.sendMessage(tabId, { type: "VF_START" });
  } catch (e) {
    chrome.tts.speak("VoiceFill cannot run on this page.", { enqueue: false });
  }
}

chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== "start-voicefill") return;
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) startOnTab(tab.id);
});

function extractJson(text) {
  if (!text) return {};
  const cleaned = text.replace(/```json|```/g, "").trim();
  const m = cleaned.match(/\{[\s\S]*\}/);
  try { return JSON.parse(m ? m[0] : cleaned); } catch { return {}; }
}

async function callGemini(prompt, images = [], raw = false, ctrl = new AbortController(), history = []) {
  const { vfToken = "" } = await chrome.storage.local.get("vfToken");
  if (!vfToken) throw new Error("NO_TOKEN");
  const headers = { "Content-Type": "application/json", "x-goog-api-key": vfToken };
  if (ctrl.signal.aborted) throw new Error("CANCELLED");
  const timer = setTimeout(() => ctrl.abort("timeout"), AI_TIMEOUT_MS);
  let res;
  let rawText;
  try {
  res = await fetch(ENDPOINT, {
    method: "POST",
    signal: ctrl.signal,
    headers,
    body: JSON.stringify({
      contents: [...history.filter((turn) => ["user", "model"].includes(turn.role) && Array.isArray(turn.parts) && turn.parts.every((part) => typeof part.text === "string")), { role: "user", parts: [{ text: prompt }, ...images.map((data) => ({ inline_data: { mime_type: "image/jpeg", data } }))] }],
      generationConfig: { responseMimeType: "application/json", temperature: 0 },
    }),
  });
  rawText = await res.text();
  } catch (e) {
    throw new Error(ctrl.signal.aborted ? (ctrl.signal.reason === "timeout" ? "TIMEOUT" : "CANCELLED") : "NETWORK");
  } finally {
    clearTimeout(timer);
  }
  let data = {}; try { data = JSON.parse(rawText); } catch {}
  if (raw) return { status: res.status, body: rawText };
  if (res.status === 401 || res.status === 403) throw new Error("BAD_TOKEN");
  if (!res.ok) throw new Error(`HTTP_${res.status}`);
  const text =
    data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") ??
    data?.text ?? data?.output ?? data?.response ?? (typeof data === "string" ? data : JSON.stringify(data));
  return extractJson(text);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "VF_START_ACTIVE") {
    chrome.tabs.query({ active: true, currentWindow: true }).then(([tab]) => tab?.id && startOnTab(tab.id));
    return;
  }
  if (msg.type === "VF_AI") {
    const key = `${sender.tab?.id}:${msg.requestId}`;
    const ctrl = new AbortController();
    requests.set(key, ctrl);
    callGemini(msg.prompt, msg.images || [], false, ctrl, msg.history || [])
      .then((json) => sendResponse({ ok: true, json }))
      .catch((e) => sendResponse({ ok: false, error: e.message }))
      .finally(() => requests.delete(key));
    return true;
  }
  if (msg.type === "VF_CANCEL_AI") {
    requests.get(`${sender.tab?.id}:${msg.requestId}`)?.abort("cancelled");
    return;
  }
  if (msg.type === "VF_CAPTURE") {
    chrome.tabs.captureVisibleTab(sender.tab?.windowId, { format: "jpeg", quality: 60 })
      .then((data) => sendResponse({ data })).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg.type === "VF_TEST") {
    const t0 = Date.now();
    callGemini(msg.prompt, [], true)
      .then((r) => sendResponse({ ok: true, ms: Date.now() - t0, ...r }))
      .catch((e) => sendResponse({ ok: false, ms: Date.now() - t0, error: e.message }));
    return true;
  }
  if (msg.type === "VF_SPEAK") {
    chrome.tts.speak(msg.text, {
      rate: msg.rate || 1,
      enqueue: false,
      onEvent: (ev) => {
        if (["end", "interrupted", "cancelled", "error"].includes(ev.type)) sendResponse({ done: true });
      },
    });
    return true;
  }
  if (msg.type === "VF_STOP_SPEAK") chrome.tts.stop();
});
