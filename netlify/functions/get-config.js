// netlify/functions/get-config.js
// Restituisce lo snapshot di una configurazione salvata, dato il numero di serie (?id=CFG-0001).

const { connectLambda, getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  };
  const id = (event.queryStringParameters && event.queryStringParameters.id || "").trim();
  if (!id) return { statusCode: 400, headers, body: JSON.stringify({ ok: false, error: "id mancante" }) };
  try {
    connectLambda(event);
    const store = getStore({ name: "nseled-config" });
    const data = await store.get(id, { type: "json" });
    if (!data) return { statusCode: 404, headers, body: JSON.stringify({ ok: false, error: "Configurazione non trovata" }) };
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(err.message || err) }) };
  }
};
