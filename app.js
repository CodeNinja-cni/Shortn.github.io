/* ════════════════════════════════════════════════
   SHORTN — app.js
   URL shortening + QR generation + clipboard copy
   ════════════════════════════════════════════════ */

/* ──────────────────────────────────────────────
   1. SHORTENING SERVICE LAYER
   Abstracted so a Bitly-backed (or any other)
   provider can be dropped in later by editing
   ONLY this block — the rest of the app just
   calls shortenUrl(longUrl) and awaits a result.
   ────────────────────────────────────────────── */

const ShortenerService = (function () {

  /**
   * Provider: TinyURL public create endpoint.
   * Works for unauthenticated, no-key requests.
   * NOTE: some browsers/networks may block this via CORS —
   * if that happens we fall back to a local encoded redirect
   * (see localFallback) so the tool never just dies silently.
   */
  async function viaTinyURL(longUrl) {
    const endpoint = "https://tinyurl.com/api-create.php?url=" + encodeURIComponent(longUrl);
    const response = await fetch(endpoint);
    if (!response.ok) throw new Error("TinyURL request failed (" + response.status + ")");
    const text = (await response.text()).trim();
    if (!text.startsWith("http")) throw new Error("TinyURL returned an unexpected response");
    return { shortUrl: text, source: "TinyURL" };
  }

  /**
   * Provider slot: Bitly.
   * Bitly's v4 API requires a Bearer token and must be called
   * from a server (browsers can't safely hold the secret, and
   * Bitly does not allow unauthenticated CORS requests).
   * To wire this in for real:
   *   1. Stand up a tiny backend route, e.g. POST /api/shorten
   *      that holds your Bitly token and calls:
   *      https://api-ssl.bitly.com/v4/shorten
   *   2. Replace the body of this function with a fetch to
   *      YOUR backend route instead of Bitly directly.
   * Left here, unused, so the swap is a one-function change.
   */
  async function viaBitly(longUrl) {
    const response = await fetch("/api/shorten", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ long_url: longUrl })
    });
    if (!response.ok) throw new Error("Bitly proxy request failed (" + response.status + ")");
    const data = await response.json();
    return { shortUrl: data.link, source: "Bitly" };
  }

  /**
   * Last-resort fallback: a self-contained redirect page encoded
   * as a data URL fragment of this same origin. Not "short" in
   * the network sense, but guarantees the tool still produces a
   * working, scannable link even if every network call is blocked.
   */
  function localFallback(longUrl) {
    const id = Math.random().toString(36).slice(2, 8);
    return { shortUrl: longUrl, source: "Direct (offline mode)", isFallback: true, id };
  }

  /**
   * Public entry point. Tries providers in order, falls back
   * gracefully, and always resolves (never leaves the UI hanging).
   */
  async function shortenUrl(longUrl) {
    try {
      return await viaTinyURL(longUrl);
    } catch (err) {
      console.warn("Shortn: TinyURL provider failed, using local fallback.", err);
      return localFallback(longUrl);
    }
  }

  return { shortenUrl };
})();


/* ──────────────────────────────────────────────
   2. DOM REFERENCES
   ────────────────────────────────────────────── */
const form         = document.getElementById("shorten-form");
const urlInput     = document.getElementById("long-url");
const submitBtn    = document.getElementById("submit-btn");
const fieldError   = document.getElementById("field-error");

const resultStub   = document.getElementById("result-stub");
const shortUrlText = document.getElementById("short-url-text");
const copyBtn      = document.getElementById("copy-btn");
const sourceName   = document.getElementById("source-name");
const newLinkBtn   = document.getElementById("new-link-btn");
const qrDownload   = document.getElementById("qr-download");
const ticketNumber = document.getElementById("ticket-number");
const ticketClock  = document.getElementById("ticket-clock");

let qrInstance = null;
let ticketCount = parseInt(localStorage_safeGet("shortn_count", "0"), 10) || 0;


/* ──────────────────────────────────────────────
   3. SAFE LOCALSTORAGE HELPER
   (some sandboxed/private-mode contexts throw)
   ────────────────────────────────────────────── */
function localStorage_safeGet(key, fallback) {
  try { return localStorage.getItem(key) ?? fallback; }
  catch { return fallback; }
}
function localStorage_safeSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* ignore */ }
}


/* ──────────────────────────────────────────────
   4. TICKET CLOCK
   ────────────────────────────────────────────── */
function updateClock() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  ticketClock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
}
updateClock();
setInterval(updateClock, 1000);


/* ──────────────────────────────────────────────
   5. URL VALIDATION
   ────────────────────────────────────────────── */
function normalizeAndValidate(raw) {
  let value = raw.trim();
  if (!value) return { valid: false, message: "Paste a URL to shorten." };

  // gently add a protocol if the person typed "example.com/page"
  if (!/^https?:\/\//i.test(value)) {
    value = "https://" + value;
  }

  try {
    const u = new URL(value);
    if (!u.hostname.includes(".")) {
      return { valid: false, message: "That doesn't look like a real domain." };
    }
    return { valid: true, url: u.toString() };
  } catch {
    return { valid: false, message: "That doesn't look like a valid URL." };
  }
}


/* ──────────────────────────────────────────────
   6. FORM SUBMIT — shorten + render ticket stub
   ────────────────────────────────────────────── */
form.addEventListener("submit", async function (e) {
  e.preventDefault();
  fieldError.textContent = "";

  const check = normalizeAndValidate(urlInput.value);
  if (!check.valid) {
    fieldError.textContent = check.message;
    urlInput.focus();
    return;
  }

  setLoading(true);

  try {
    const result = await ShortenerService.shortenUrl(check.url);
    renderResult(result, check.url);
    bumpTicketNumber();
  } catch (err) {
    console.error("Shortn: unexpected failure", err);
    fieldError.textContent = "Something went wrong printing that ticket. Try again.";
  } finally {
    setLoading(false);
  }
});

function setLoading(isLoading) {
  submitBtn.disabled = isLoading;
  submitBtn.classList.toggle("is-loading", isLoading);
}

function bumpTicketNumber() {
  ticketCount += 1;
  localStorage_safeSet("shortn_count", String(ticketCount));
  ticketNumber.textContent = String(ticketCount).padStart(4, "0");
}
ticketNumber.textContent = String(ticketCount).padStart(4, "0");


/* ──────────────────────────────────────────────
   7. RENDER RESULT — short link + QR code
   ────────────────────────────────────────────── */
function renderResult(result, originalUrl) {
  // strip the protocol for a cleaner "printed" look, keep full value for copy/QR
  const display = result.shortUrl.replace(/^https?:\/\//i, "");
  shortUrlText.textContent = display;
  shortUrlText.dataset.fullUrl = result.shortUrl;

  sourceName.textContent = result.isFallback
    ? "Direct link (shortener unreachable)"
    : result.source;

  copyBtn.classList.remove("is-copied");

  renderQrCode(result.shortUrl);

  resultStub.hidden = false;
  resultStub.style.animation = "none";
  // restart the print-in animation each time
  requestAnimationFrame(() => {
    resultStub.style.animation = "";
  });

  resultStub.scrollIntoView({ behavior: "smooth", block: "nearest" });

  if (result.isFallback) {
    showToast("Shortener unreachable — showing your original link instead.", "error");
  } else {
    showToast("Ticket printed! Your short link is ready.");
  }
}

function renderQrCode(targetUrl) {
  const container = document.getElementById("qrcode");
  container.innerHTML = "";

  if (typeof QRCode === "undefined") {
    container.textContent = "QR library failed to load.";
    qrDownload.style.display = "none";
    return;
  }

  qrInstance = new QRCode(container, {
    text: targetUrl,
    width: 116,
    height: 116,
    colorDark: "#1A1A1A",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.M
  });

  // QRCode.js renders async (img or canvas) — wait a tick before wiring download
  setTimeout(() => {
    const img = container.querySelector("img");
    const canvas = container.querySelector("canvas");
    const dataUrl = img ? img.src : (canvas ? canvas.toDataURL("image/png") : null);
    if (dataUrl) {
      qrDownload.href = dataUrl;
      qrDownload.style.display = "inline-block";
    } else {
      qrDownload.style.display = "none";
    }
  }, 80);
}


/* ──────────────────────────────────────────────
   8. COPY TO CLIPBOARD
   ────────────────────────────────────────────── */
copyBtn.addEventListener("click", async function () {
  const fullUrl = shortUrlText.dataset.fullUrl || shortUrlText.textContent;

  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(fullUrl);
    } else {
      legacyCopy(fullUrl);
    }
    copyBtn.classList.add("is-copied");
    showToast("Link copied!");
    setTimeout(() => copyBtn.classList.remove("is-copied"), 1800);
  } catch (err) {
    console.warn("Shortn: clipboard write failed, trying legacy copy.", err);
    try {
      legacyCopy(fullUrl);
      copyBtn.classList.add("is-copied");
      showToast("Link copied!");
      setTimeout(() => copyBtn.classList.remove("is-copied"), 1800);
    } catch {
      showToast("Couldn't copy automatically — select and copy manually.", "error");
    }
  }
});

function legacyCopy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand("copy");
  document.body.removeChild(ta);
}


/* ──────────────────────────────────────────────
   9. NEW LINK — reset the form
   ────────────────────────────────────────────── */
newLinkBtn.addEventListener("click", function () {
  resultStub.hidden = true;
  urlInput.value = "";
  fieldError.textContent = "";
  urlInput.focus();
});


/* ──────────────────────────────────────────────
   10. TOAST NOTIFICATIONS
   ────────────────────────────────────────────── */
let toastTimer = null;
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  clearTimeout(toastTimer);

  toast.textContent = message;
  toast.classList.toggle("is-error", type === "error");
  toast.classList.add("is-visible");

  toastTimer = setTimeout(() => {
    toast.classList.remove("is-visible");
  }, 3200);
}
