// netlify/functions/odoo-prices.js
// Riceve una lista di codici (default_code) e restituisce il prezzo di listino
// (list_price) del prodotto corrispondente in Odoo. Sola lettura.

const ODOO_URL = process.env.ODOO_URL;
const ODOO_DB = process.env.ODOO_DB;
const ODOO_LOGIN = process.env.ODOO_LOGIN;
const ODOO_API_KEY = process.env.ODOO_API_KEY;
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN;

async function rpc(service, method, args) {
  const res = await fetch(ODOO_URL + "/jsonrpc", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", method: "call", params: { service, method, args }, id: Date.now() })
  });
  const data = await res.json();
  if (data.error) {
    const msg = data.error.data && data.error.data.message ? data.error.data.message : data.error.message;
    throw new Error(msg || "Errore RPC Odoo");
  }
  return data.result;
}
const kw = (uid, model, method, args, kwargs) =>
  rpc("object", "execute_kw", [ODOO_DB, uid, ODOO_API_KEY, model, method, args, kwargs || {}]);

exports.handler = async (event) => {
  const cors = {
    "Access-Control-Allow-Origin": ALLOW_ORIGIN || "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
  if (event.httpMethod === "OPTIONS") return { statusCode: 204, headers: cors, body: "" };
  if (event.httpMethod !== "POST") return { statusCode: 405, headers: cors, body: JSON.stringify({ ok: false, error: "Metodo non consentito" }) };
  if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: "Connettore non configurato." }) };
  }

  let body;
  try { body = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: "JSON non valido" }) }; }
  const codes = Array.isArray(body.codes) ? body.codes.map(c => String(c).trim()).filter(Boolean) : [];
  if (!codes.length) return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: "Nessun codice fornito" }) };

  try {
    const uid = await rpc("common", "authenticate", [ODOO_DB, ODOO_LOGIN, ODOO_API_KEY, {}]);
    if (!uid) return { statusCode: 401, headers: cors, body: JSON.stringify({ ok: false, error: "Autenticazione Odoo fallita." }) };

    // legge in blocco i prodotti con quei default_code
    const uniq = [...new Set(codes)];
    const recs = await kw(uid, "product.product", "search_read",
      [[["default_code", "in", uniq]]], { fields: ["default_code", "list_price"] });

    const prices = {};   // code -> list_price
    (recs || []).forEach(r => { if (r.default_code) prices[r.default_code] = r.list_price; });

    // segnala i codici non trovati
    const missing = uniq.filter(c => !(c in prices));

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, prices, missing }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: String(err.message || err) }) };
  }
};
