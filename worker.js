/**
 * Cloudflare Worker for Google Chat Bot with Service Account Authentication.
 * Required Environment Variables (Secrets):
 * - SERVICE_ACCOUNT_CLIENT_EMAIL: Google Service Account client email.
 * - SERVICE_ACCOUNT_PRIVATE_KEY: Google Service Account private key (PEM format with newlines).
 */

import { SignJWT, importPKCS8 } from "jose";

// In-memory cache for the access token
let cachedAccessToken = null;
let tokenExpiresAt = 0; // Timestamp (in milliseconds) when the token expires

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_CHAT_SCOPE = "https://www.googleapis.com/auth/chat.bot";

/** Generates/retrieves a Google Chat API access token using service account credentials and caches it. */
async function getGoogleChatToken(env) {
  const serviceAccount = JSON.parse(env.GOOGLE_SERVICE_ACCOUNT);

  // Use cached token if valid (with a 1-minute buffer)
  if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) return cachedAccessToken;

  const privateKey = await importPKCS8(serviceAccount.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const jwt = await new SignJWT({
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: GOOGLE_TOKEN_URL,
    scope: GOOGLE_CHAT_SCOPE,
    iat: now,
    // Google access tokens from JWT grant are valid for max 1 hour
    exp: now + 3600,
  })
    .setProtectedHeader({ alg: "RS256", typ: "JWT", kid: serviceAccount.private_key_id })
    .sign(privateKey);

  const tokenData = await fetch(GOOGLE_TOKEN_URL, {
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

  const { type, space, message } = await request.json();

  switch (type) {
    case "ADDED_TO_SPACE":
      return jsonResponse({ text: "Thanks for adding me! Ask a question." });

    case "REMOVED_FROM_SPACE":
      return jsonResponse(null);

    case "MESSAGE":
      const userMessageText = message.text.trim();
      let apiToken;
      try {
        apiToken = await getGoogleChatToken(env);
      } catch (error) {
        return jsonResponse({ text: `ERROR: Could not obtain API token. ${error}` });
      }

      ctx.waitUntil(processMessageEvent(apiToken, space.name, userMessageText));
      return jsonResponse(null);

    default:
      return jsonResponse({ text: `ERROR: Received unknown event type: ${type}` });
  }
}

function jsonResponse(data) {
  return new Response(JSON.stringify(data), {
    headers: { "Content-Type": "application/json" },
  });
}

/** Processes a MESSAGE event: sends an initial message, waits 5s, then edits it. */
async function processMessageEvent(apiToken, spaceName, userMessage) {
  const chatApiBaseUrl = "https://chat.googleapis.com/v1";
  const initialMessagePayload = { text: "Working on it..." };
  const createMessageUrl = `${chatApiBaseUrl}/${spaceName}/messages`;
  const { name } = await sendChat("POST", apiToken, createMessageUrl, initialMessagePayload);

  const updatedMessagePayload = { text: `You asked: ${userMessage}` };
  const editMessageUrl = `${chatApiBaseUrl}/${name}?updateMask=text`;
  await sendChat("PATCH", apiToken, editMessageUrl, updatedMessagePayload);
}

async function sendChat(method, apiToken, url, payload) {
  return await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${apiToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).then((response) => response.json());
}

export default {
  fetch: handleRequest,
};
