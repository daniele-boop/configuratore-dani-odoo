// netlify/functions/get-catalog.js
// Restituisce il catalogo salvato lato server (Netlify Blobs).
// Se non è ancora stato salvato nulla, risponde 404 e il sito ricade sul catalog.json statico.

const { connectLambda, getStore } = require("@netlify/blobs");

exports.handler = async (event) => {
  const headers = {
    "Content-Type": "application/json",
    "Cache-Control": "no-store",
    "Access-Control-Allow-Origin": "*"
  };
  try {
    connectLambda(event);
    const store = getStore({ name: "nseled-catalog" });
    const data = await store.get("catalog", { type: "json" });
    if (!data) return { statusCode: 404, headers, body: JSON.stringify({ ok: false }) };
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch (err) {
    return { statusCode: 500, headers, body: JSON.stringify({ ok: false, error: String(err.message || err) }) };
  }
};
