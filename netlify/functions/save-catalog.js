// netlify/functions/save-catalog.js
// Salva il catalogo lato server (Netlify Blobs), protetto da un token.
//
// VARIABILE D'AMBIENTE da impostare su Netlify:
//   ADMIN_TOKEN = una stringa segreta a tua scelta (NON è la password del pannello)
//
// Il pannello chiede questo token al momento del salvataggio e lo invia una sola volta.
// Il token vero vive solo nelle variabili d'ambiente di Netlify, mai nel codice del sito.

const { connectLambda, getStore } = require("@netlify/blobs");
const { ADMIN_TOKEN } = process.env;

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers, body: JSON.stringify({ ok: false, error: "Metodo non consentito" }) };

  if (!ADMIN_TOKEN) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: "ADMIN_TOKEN non configurato su Netlify." }) };
  }

  let payload;
  try { payload = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "JSON non valido" }) }; }

  if (!payload.token || payload.token !== ADMIN_TOKEN) {
    return { statusCode: 401, headers, body: JSON.stringify({ ok: false, error: "Token non valido." }) };
  }

  const catalog = payload.catalog;
  if (!catalog || !Array.isArray(catalog.products) || !catalog.products.length) {
    return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "Catalogo assente o senza prodotti." }) };
  }

  try {
    connectLambda(event);
    const store = getStore({ name: "nseled-catalog" });
    await store.setJSON("catalog", catalog);
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, savedAt: new Date().toISOString() }) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(err.message || err) }) };
  }
};
