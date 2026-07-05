// netlify/functions/save-config.js
// Salva uno "snapshot" della configurazione con un numero progressivo (CFG-0001…)
// nei Netlify Blobs. I prezzi sono congelati perché lo snapshot include il prodotto
// e i controller così com'erano al momento del salvataggio.

const { connectLambda, getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: "Metodo non consentito" }) };

  let snap;
  try { snap = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "JSON non valido" }) }; }
  if (!snap.productId || !snap.selWc || !snap.selHc) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Configurazione incompleta" }) };
  }

  try {
    connectLambda(event);
    const store = getStore({ name: "nseled-config" });
    // contatore progressivo (best-effort)
    let counter = 0;
    try { const c = await store.get("_counter", { type: "json" }); if (c && c.n) counter = c.n; } catch (e) {}
    counter += 1;
    const serial = "CFG-" + String(counter).padStart(4, "0");
    snap.serial = serial;
    snap.createdAt = new Date().toISOString();
    await store.setJSON("_counter", { n: counter });
    await store.setJSON(serial, snap);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, serial }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(err.message || err) }) };
  }
};
