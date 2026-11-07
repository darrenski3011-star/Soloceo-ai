import crypto from "node:crypto";
import { operatorStore } from "./operator-store.js";

const base = () => (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
const anon = () => process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const scopes = ["openid","email","https://www.googleapis.com/auth/gmail.send","https://www.googleapis.com/auth/gmail.readonly"];

export async function getSupabaseUser(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token || !base() || !anon()) throw new Error("Log in to GoSolo first.");
  const response = await fetch(base()+"/auth/v1/user", {headers:{apikey:anon(),Authorization:"Bearer "+token}});
  const user = await response.json().catch(()=>({}));
  if (!response.ok || !user.id || !user.email) throw new Error("Your GoSolo login expired. Log in again.");
  return user;
}

export function getGoogleScopes(){ return scopes; }

export function encryptRefreshToken(value) {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || "";
  let key;
  if (/^[a-f0-9]{64}$/i.test(raw)) key = Buffer.from(raw,"hex");
  else key = Buffer.from(raw,"base64");
  if (key.length !== 32) throw new Error("GOOGLE_TOKEN_ENCRYPTION_KEY must be a 32-byte base64 or 64-character hex key.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm",key,iv);
  const encrypted = Buffer.concat([cipher.update(value,"utf8"),cipher.final()]);
  return {encrypted_refresh_token:encrypted.toString("base64"),token_iv:iv.toString("base64"),token_tag:cipher.getAuthTag().toString("base64")};
}

export function decryptRefreshToken(row) {
  const raw = process.env.GOOGLE_TOKEN_ENCRYPTION_KEY || "";
  const key = /^[a-f0-9]{64}$/i.test(raw) ? Buffer.from(raw,"hex") : Buffer.from(raw,"base64");
  if (key.length !== 32) throw new Error("Google token encryption is not configured.");
  const decipher = crypto.createDecipheriv("aes-256-gcm",key,Buffer.from(row.token_iv,"base64"));
  decipher.setAuthTag(Buffer.from(row.token_tag,"base64"));
  return Buffer.concat([decipher.update(Buffer.from(row.encrypted_refresh_token,"base64")),decipher.final()]).toString("utf8");
}

export async function getGoogleTokenRow(userId) {
  const rows = await operatorStore("/rest/v1/google_oauth_tokens?select=*&user_id=eq."+encodeURIComponent(userId));
  return rows?.[0] || null;
}

export async function getGoogleAccessToken(userId) {
  const row = await getGoogleTokenRow(userId);
  if (!row) throw new Error("Connect Gmail to GoSolo before sending outreach.");
  const refreshToken = decryptRefreshToken(row);
  const response = await fetch("https://oauth2.googleapis.com/token",{
    method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:process.env.GOOGLE_CLIENT_ID||"",client_secret:process.env.GOOGLE_CLIENT_SECRET||"",refresh_token:refreshToken,grant_type:"refresh_token"})
  });
  const data = await response.json().catch(()=>({}));
  if (!response.ok || !data.access_token) throw new Error("Google could not refresh the Gmail connection. Reconnect Gmail in GoSolo.");
  return {accessToken:data.access_token,email:row.google_email};
}

export async function getOperatorUserAndSubscription(req) {
  const user=await getSupabaseUser(req);
  const {getGoSoloAccess}=await import("./billing.js");
  const access=await getGoSoloAccess(req);
  if(!access) throw new Error("An active GoSolo subscription is required.");
  if(!access.owner) {
    const checkoutEmail=access.checkout.customer_details?.email||access.checkout.customer_email||"";
    if(checkoutEmail && checkoutEmail.toLowerCase()!==user.email.toLowerCase()) throw new Error("Your GoSolo login email must match your subscription email.");
  }
  return user;
}
