/**
 * Cloudflare Worker for Google Chat Bot with Service Account Authentication.
 * Required Environment Variables (Secrets):
 * - SERVICE_ACCOUNT_CLIENT_EMAIL: Google Service Account client email.
 * - SERVICE_ACCOUNT_PRIVATE_KEY: Google Service Account private key (PEM format with newlines).
 */

import { intentPrompt, answerPrompt, query } from "./config.js";
import { SignJWT, importPKCS8 } from "jose";

// In-memory cache for the access token
let cachedAccessToken = null;
let tokenExpiresAt = 0; // Timestamp (in milliseconds) when the token expires

/** Generates/retrieves a Google Chat API access token using service account credentials and caches it. */
async function getToken(env) {
  const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);

  // Use cached token if valid (with a 1-minute buffer)
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) return cachedAccessToken;

  const privateKey = await importPKCS8(serviceAccount.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: "https://www.googleapis.com/auth/chat.bot https://www.googleapis.com/auth/bigquery.readonly",
    iat: now,
    // Google access tokens from JWT grant are valid for max 1 hour
    exp: now + 3600,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: serviceAccount.private_key_id })
    .sign(privateKey);

  const tokenData = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  }).then((response) => response.json());

  cachedAccessToken = tokenData.access_token;
  tokenExpiresAt = Date.now() + tokenData.expires_in * 1000; // expires_in is in seconds
  return cachedAccessToken;
}

/** Handles HTTP requests to the Cloudflare Worker. */
async function handleRequest(request, env, ctx) {
  const url = new URL(request.url);
  if (url.pathname !== "/googlechat") return new Response("Endpoint not found. Use /googlechat", { status: 404 });
  if (request.method !== "POST") return new Response("Only POST accepted", { status: 405, headers: { Allow: "POST" } });
  if (!request.headers.get("content-type")?.includes("application/json"))
    return new Response("Content-Type must be application/json", { status: 415 });

  const body = await request.json();

  switch (body.type) {
    case "ADDED_TO_SPACE":
      return jsonResponse({ text: "Thanks for adding me! #TODO explain what the app does." });

    case "REMOVED_FROM_SPACE":
      return jsonResponse(null);

    case "MESSAGE":
      let apiToken;
      try {
        apiToken = await getToken(env);
      } catch (error) {
        return jsonResponse({ text: `ERROR: Could not obtain API token. ${error}` });
      }

      ctx.waitUntil(processMessageEvent(apiToken, body, env));
      return new Response(null, { status: 204 });

    default:
      return jsonResponse({ text: `ERROR: Received unknown event type: ${body.type}` });
  }
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

async function llm(body, env) {
  const base_url = env.OPENAI_BASE_URL ?? "https://api.openai.com/v1";
  return await fetch(`${base_url}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY}` },
    body: JSON.stringify(body),
  }).then((response) => response.json());
}

/** Processes a MESSAGE event: sends an initial message, waits 5s, then edits it. */
async function processMessageEvent(apiToken, request, env) {
  const chatApiBaseUrl = "https://chat.googleapis.com/v1";
  const payload = { question: request.message.text, status: "Thinking..." };
  const createMessageUrl = `${chatApiBaseUrl}/${request.space.name}/messages`;

  const { name } = await sendChat("POST", apiToken, createMessageUrl, payload);
  const editMessageUrl = `${chatApiBaseUrl}/${name}?updateMask=*`;

  const body = {
    model: "gpt-4.1-mini",
    messages: [
      { role: "system", content: intentPrompt },
      { role: "user", content: request.message.text },
    ],
  };
  const intent = await llm(body, env);
  const response = intent.choices[0].message.content;

  const sql = Array.from(response.matchAll(/```sql\s*([\s\S]*?)```/gi), (m) => m[1].trim()).join("\n");
  payload.status = sql ? "Running query..." : "";

  // Extract SQL code blocks and concatenate them
  if (!sql) {
    payload.status = "";
    payload.answer = response;
    await sendChat("PATCH", apiToken, editMessageUrl, payload);
    return;
  } else {
    payload.status = "Running query...";
    payload.sql = response;
    await sendChat("PATCH", apiToken, editMessageUrl, payload);
    let data;
    try {
      data = await query(apiToken, sql);
      payload.status = `Fetched ${data.length} rows. Interpreting...`;
      await sendChat("PATCH", apiToken, editMessageUrl, payload);
    } catch (error) {
      payload.status = "";
      payload.error = error;
      await sendChat("PATCH", apiToken, editMessageUrl, payload);
      return;
    }
    const body = {
      model: "gpt-4.1-nano",
      messages: [{ role: "system", content: answerPrompt(JSON.stringify(data.slice(0, 1000)), request.message.text) }],
    };
    const answerResponse = await llm(body, env);
    const answer = answerResponse.choices[0].message.content;
    payload.status = "";
    payload.answer = answer;
    await sendChat("PATCH", apiToken, editMessageUrl, payload);
  }
}

async function sendChat(method, apiToken, url, payload) {
  const text = [`*🗨️ ${payload.question}*`, payload.status, payload.sql, payload.answer, payload.error]
    .filter((d) => d)
    .join("\n")
    // Google Chat doesn't handle language markers for code fences
    .replace(/```sql/g, "```")
    // Google Chat uses * not ** for bold
    .replace(/\*\*/g, "*");
  return await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ text, formattedText: text }),
  }).then((response) => response.json());
}

export default {
  fetch: handleRequest,
};
