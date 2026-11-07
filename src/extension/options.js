const KEYS = ["fullName", "dateOfBirth", "email", "address", "phone", "gender"];
const $ = (id) => document.getElementById(id);
const rate = $("rate"), out = $("rateOut");
const showRate = () => (out.textContent = Number(rate.value).toFixed(1) + "×");
rate.addEventListener("input", showRate);

chrome.storage.local.get(["vfProfile", "vfRate", "vfToken"]).then(({ vfProfile = {}, vfRate = 1, vfToken = "" }) => {
  KEYS.forEach((k) => ($(k).value = vfProfile[k] || ""));
  rate.value = vfRate; showRate();
  $("token").value = vfToken;
});

$("f").addEventListener("submit", async (e) => {
  e.preventDefault();
  const vfProfile = Object.fromEntries(KEYS.map((k) => [k, $(k).value.trim()]));
  await chrome.storage.local.set({ vfProfile, vfRate: Number(rate.value), vfToken: $("token").value.trim() });
  $("status").textContent = "Settings saved on this computer.";
});

$("toggleToken").addEventListener("click", () => {
  const show = $("token").type === "password";
  $("token").type = show ? "text" : "password";
  $("toggleToken").textContent = show ? "Hide" : "Show";
  $("toggleToken").setAttribute("aria-pressed", String(show));
});

$("runTest").addEventListener("click", async () => {
  const outEl = $("testOut");
  outEl.textContent = "Sending…";
  await chrome.storage.local.set({ vfToken: $("token").value.trim() });
  const r = await chrome.runtime.sendMessage({ type: "VF_TEST", prompt: $("testPrompt").value });
  if (!r) { outEl.textContent = "No answer from the extension background."; return; }
  if (!r.ok) { outEl.textContent = `Failed after ${r.ms} ms: ${r.error}`; return; }
  let body = r.body; try { body = JSON.stringify(JSON.parse(body), null, 2); } catch {}
  outEl.textContent = `HTTP ${r.status} in ${r.ms} ms\n\n${body}`;
});
