import crypto from "node:crypto";
import {encryptRefreshToken,getGoogleScopes} from "../../lib/google-oauth.js";
import {operatorStore} from "../../lib/operator-store.js";

function fail(res,message){res.setHeader("Set-Cookie","gosolo_google_oauth=; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0");return res.status(400).send("<!doctype html><title>GoSolo Gmail connection</title><p>"+message.replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]))+"</p><p>You can close this tab and return to GoSolo.</p>");}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET") return res.status(405).send("Use GET.");
  try{
    if(req.query?.error) return fail(res,"Google did not authorize the Gmail connection.");
    const cookie=String(req.headers.cookie||"").split(";").map(x=>x.trim()).find(x=>x.startsWith("gosolo_google_oauth="))?.slice("gosolo_google_oauth=".length);
    if(!cookie||!req.query?.code||!req.query?.state) return fail(res,"The Google connection expired. Start again from GoSolo.");
    const [payload,signature]=decodeURIComponent(cookie).split(".");
    const expected=crypto.createHmac("sha256",process.env.APP_SESSION_SECRET||"").update(payload||"").digest("hex");
    const a=Buffer.from(String(signature||"")),b=Buffer.from(expected);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b)) return fail(res,"Google connection verification failed.");
    const session=JSON.parse(Buffer.from(payload,"base64url").toString("utf8"));
    if(session.state!==req.query.state||Date.now()-session.createdAt>10*60*1000) return fail(res,"Google connection expired or did not match.");
    const tokenResponse=await fetch("https://oauth2.googleapis.com/token",{method:"POST",headers:{"Content-Type":"application/x-www-form-urlencoded"},body:new URLSearchParams({code:String(req.query.code),client_id:process.env.GOOGLE_CLIENT_ID||"",client_secret:process.env.GOOGLE_CLIENT_SECRET||"",redirect_uri:process.env.GOOGLE_REDIRECT_URI||"",grant_type:"authorization_code"})});
    const tokens=await tokenResponse.json().catch(()=>({}));
    if(!tokenResponse.ok||!tokens.refresh_token) return fail(res,"Google did not return offline access. Remove GoSolo access from your Google Account and reconnect.");
    const profileResponse=await fetch("https://www.googleapis.com/oauth2/v2/userinfo",{headers:{Authorization:"Bearer "+tokens.access_token}});
    const profile=await profileResponse.json().catch(()=>({}));
    if(!profile.email) return fail(res,"Google did not provide the connected Gmail address.");
    const encrypted=encryptRefreshToken(tokens.refresh_token);
    await operatorStore("/rest/v1/google_oauth_tokens?on_conflict=user_id",{method:"POST",headers:{Prefer:"resolution=merge-duplicates,return=minimal"},body:JSON.stringify({user_id:session.userId,google_email:profile.email,...encrypted,scopes:getGoogleScopes(),updated_at:new Date().toISOString()})});
    res.setHeader("Set-Cookie","gosolo_google_oauth=; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=0");
    res.setHeader("Location","/?gmail=connected");
    return res.status(302).end();
  }catch(error){console.error("GoSolo Google OAuth callback:",error);return fail(res,"GoSolo could not securely save the Gmail connection. Check the server configuration and reconnect.");}
}
