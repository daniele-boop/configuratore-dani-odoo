// netlify/functions/odoo-quote.js
//
// Riceve l'offerta esportata dal configuratore e crea una quotation (sale.order)
// bozza in Odoo Online tramite JSON-RPC (endpoint /jsonrpc, metodo execute_kw).
//
// PREREQUISITI
// - Piano Odoo "Custom" (l'API esterna non è attiva su One App Free / Standard).
// - Un utente Odoo con una API key (Impostazioni -> Sicurezza account -> nuova API key,
//   in modalità sviluppatore) oppure con una password impostata sull'utente.
// - I prodotti (cabinet per risoluzione) già presenti in Odoo, ognuno con il suo
//   "Riferimento interno" (default_code) uguale al codice inserito nel configuratore.
//
// VARIABILI D'AMBIENTE da impostare su Netlify (Site settings -> Environment variables):
//   ODOO_URL       es. https://nseled-europe.odoo.com   (senza slash finale)
//   ODOO_DB        nome del database (di solito il sottodominio, es. nseled-europe)
//   ODOO_LOGIN     login dell'utente (email)
//   ODOO_API_KEY   la API key (o la password dell'utente)
//   ODOO_PARTNER_ID    (opzionale) id di un cliente esistente da usare sempre
//   ODOO_PARTNER_NAME  (opzionale) nome del cliente standard segnaposto,
//                      default "Cliente da definire" (creato al primo utilizzo)
//   ALLOW_ORIGIN       (opzionale) origine consentita per il CORS, es. https://tuosito.netlify.app
//
// NOTA: JSON-RPC/XML-RPC sono in deprecazione in Odoo; quando migrerai, il connettore
// andrà riscritto sulla nuova "JSON-2 API" (/json/2/{model}/{method}, bearer token).

const {
  ODOO_URL, ODOO_DB, ODOO_LOGIN, ODOO_API_KEY,
  ODOO_PARTNER_ID, ODOO_PARTNER_NAME, ALLOW_ORIGIN
} = process.env;

async function rpc(service, method, args) {
  const res = await fetch(`${ODOO_URL}/jsonrpc`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", method: "call",
      params: { service, method, args },
      id: Date.now()
    })
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
  if (event.httpMethod !== "POST")   return { statusCode: 405, headers: cors, body: JSON.stringify({ ok: false, error: "Metodo non consentito" }) };

  if (!ODOO_URL || !ODOO_DB || !ODOO_LOGIN || !ODOO_API_KEY) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: "Connettore non configurato: mancano le variabili d'ambiente Odoo." }) };
  }

  let offer;
  try { offer = JSON.parse(event.body || "{}"); }
  catch { return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: "JSON non valido" }) }; }

  const lines = Array.isArray(offer.lines) ? offer.lines : [];
  if (!lines.length) return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: "Nessuna riga nell'offerta" }) };

  try {
    // 1) autenticazione -> uid
    const uid = await rpc("common", "authenticate", [ODOO_DB, ODOO_LOGIN, ODOO_API_KEY, {}]);
    if (!uid) return { statusCode: 401, headers: cors, body: JSON.stringify({ ok: false, error: "Autenticazione Odoo fallita (login/API key)." }) };

    // 2) cliente standard: usa partner passato / ODOO_PARTNER_ID, altrimenti
    //    trova-o-crea un cliente segnaposto per nome (il commerciale lo cambierà poi).
    let partnerId = Number(offer.partner_id) || Number(ODOO_PARTNER_ID) || 0;
    if (!partnerId) {
      const name = ODOO_PARTNER_NAME || "Cliente da definire";
      const ex = await kw(uid, "res.partner", "search_read", [[["name", "=", name]]], { fields: ["id"], limit: 1 });
      partnerId = ex.length ? ex[0].id : await kw(uid, "res.partner", "create", [{ name, is_company: true, customer_rank: 1 }]);
    }

    // 3) risolvi i prodotti dai codici (default_code) e prepara le righe.
    //    Il prezzo NON viene forzato: lo calcola Odoo dal listino del prodotto/cliente.
    const orderLines = [];
    const missing = [];
    for (const l of lines) {
      const code = (l.code || "").trim();
      if (!code) { missing.push(l.label || "(senza codice)"); continue; }
      const found = await kw(uid, "product.product", "search_read",
        [[["default_code", "=", code]]], { fields: ["id"], limit: 1 });
      if (!found.length) { missing.push(code); continue; }
      orderLines.push([0, 0, { product_id: found[0].id, product_uom_qty: l.qty }]);
    }
    if (missing.length) {
      return { statusCode: 422, headers: cors, body: JSON.stringify({ ok: false, error: "Codici non trovati in Odoo: " + missing.join(", ") }) };
    }

    // 4) crea la quotation (sale.order) in bozza
    const summary = `Configuratore parete LED — ${offer.product || ""} · ${offer.size ? offer.size.w + "×" + offer.size.h + " mm" : ""}` +
                 (offer.resolution ? ` · ${offer.resolution.label}` : "");
    // Campo "Terms and conditions" (note): riepilogo + immagine anteprima incorporata
    let note = `<p>${summary}</p>`;
    if (typeof offer.previewPng === "string" && offer.previewPng.startsWith("data:image")) {
      note += `<p><img src="${offer.previewPng}" alt="Anteprima parete LED" style="max-width:100%;height:auto;"/></p>`;
    }
    const orderId = await kw(uid, "sale.order", "create", [{
      partner_id: partnerId,
      order_line: orderLines,
      client_order_ref: summary,
      note: note
    }]);

    const info = await kw(uid, "sale.order", "read", [[orderId]], { fields: ["name"] });
    const name = info && info[0] ? info[0].name : ("SO/" + orderId);
    const url = `${ODOO_URL}/odoo/sales/${orderId}`;

    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, order_id: orderId, name, url }) };
  } catch (err) {
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: String(err.message || err) }) };
  }
};
