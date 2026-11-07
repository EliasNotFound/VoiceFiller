import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import icon from "@/assets/icon.png";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "VoiceFill — Fill web forms with your voice" },
      { name: "description", content: "A Chrome extension that fills web forms by voice for blind and low-vision people, using a profile stored only on your computer." },
      { property: "og:title", content: "VoiceFill — Fill web forms with your voice" },
      { property: "og:description", content: "Voice-first form filling for blind and low-vision people. Your profile stays on your device." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function download() {
  fetch("/voice-form-filler.zip")
    .then((r) => { if (!r.ok) throw new Error(`Download failed: ${r.status}`); return r.blob(); })
    .then((b) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(b);
      a.download = "voice-form-filler.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((e) => alert(e.message));
}

const field = "mt-2 w-full rounded-lg border-2 border-input bg-background px-4 py-3 text-lg text-foreground focus:border-ring focus:outline-none focus:ring-4 focus:ring-ring/40";
const lab = "mt-6 block text-lg font-bold";

function Index() {
  const [sent, setSent] = useState<string | null>(null);
  return (
    <div className="min-h-screen bg-background font-sans text-foreground">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:m-4 focus:rounded focus:bg-signal focus:p-3 focus:text-signal-foreground">Skip to content</a>
      <main id="main" className="mx-auto max-w-4xl px-6 py-16">
        <header className="flex items-center gap-4">
          <img src={icon} alt="" width={64} height={64} className="rounded-xl" />
          <span className="font-display text-2xl tracking-wide text-signal">VoiceFill</span>
        </header>

        <h1 className="mt-12 font-display text-5xl leading-tight md:text-7xl">
          Forms, filled <span className="text-signal">by voice.</span>
        </h1>
        <p className="mt-6 max-w-2xl text-xl text-muted-foreground">
          A Chrome extension for blind and low-vision people. It fills what it knows from your profile, asks you aloud for the rest, reads everything back, and submits only when you say so.
        </p>
        <button onClick={download} className="mt-10 rounded-xl bg-signal px-8 py-5 text-xl font-bold text-signal-foreground focus:outline-none focus:ring-4 focus:ring-foreground focus:ring-offset-4 focus:ring-offset-background">
          Download extension
        </button>

        <section aria-labelledby="install" className="mt-20">
          <h2 id="install" className="font-display text-3xl">Install in four steps</h2>
          <ol className="mt-6 list-decimal space-y-3 pl-6 text-xl">
            <li>Unzip the downloaded file.</li>
            <li>Open <strong>chrome://extensions</strong> in Chrome, Edge or Brave.</li>
            <li>Turn on <strong>Developer mode</strong> (top right).</li>
            <li>Choose <strong>Load unpacked</strong> and select the unzipped folder.</li>
          </ol>
          <p className="mt-6 text-xl text-muted-foreground">
            Then open the extension's settings, enter your profile and AI access token, and press <strong>Alt + Shift + F</strong> on any form. Press <strong>Escape</strong> to stop at any time.
          </p>
        </section>

        <section aria-labelledby="demo" className="mt-20 rounded-2xl border-2 border-border bg-card p-8">
          <h2 id="demo" className="font-display text-3xl">Try it on this form</h2>
          <p className="mt-2 text-lg text-muted-foreground">Every field is required. Nothing is sent anywhere.</p>
          <form onSubmit={(e) => { e.preventDefault(); const d = new FormData(e.currentTarget); setSent(`Thanks, ${d.get("name")}. Form received.`); }}>
            <label className={lab} htmlFor="name">Full name</label>
            <input className={field} id="name" name="name" required autoComplete="off" />
            <label className={lab} htmlFor="dob">Date of birth</label>
            <input className={field} id="dob" name="dob" type="date" required />
            <label className={lab} htmlFor="em">Email address</label>
            <input className={field} id="em" name="email" type="email" required autoComplete="off" />
            <label className={lab} htmlFor="addr">Home address</label>
            <textarea className={field} id="addr" name="address" rows={2} required />
            <label className={lab} htmlFor="ph">Phone number</label>
            <input className={field} id="ph" name="phone" type="tel" required autoComplete="off" />
            <label className={lab} htmlFor="gender">Gender</label>
            <select className={field} id="gender" name="gender" required defaultValue="">
              <option value="">Select…</option><option>Female</option><option>Male</option><option>Non-binary</option><option>Prefer not to say</option>
            </select>
            <label className={lab} htmlFor="ecn">Emergency contact name</label>
            <input className={field} id="ecn" name="ecName" required autoComplete="off" />
            <label className={lab} htmlFor="ecp">Emergency contact phone</label>
            <input className={field} id="ecp" name="ecPhone" type="tel" required autoComplete="off" />
            <button type="submit" className="mt-8 rounded-xl bg-signal px-8 py-4 text-xl font-bold text-signal-foreground focus:outline-none focus:ring-4 focus:ring-foreground">Submit</button>
            <p role="status" aria-live="polite" className="mt-4 text-xl font-bold text-signal">{sent}</p>
          </form>
        </section>
      </main>
    </div>
  );
}
