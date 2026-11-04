import crypto from "node:crypto";
import {getOperatorUserAndSubscription,getGoogleScopes} from "../../lib/google-oauth.js";

export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({error:"Use POST."});
  try{
    const user=await getOperatorUserAndSubscription(req);
    const clientId=process.env.GOOGLE_CLIENT_ID||"";
    const redirectUri=process.env.GOOGLE_REDIRECT_URI||"";
    if(!clientId||!redirectUri||!process.env.GOOGLE_CLIENT_SECRET||!process.env.GOOGLE_TOKEN_ENCRYPTION_KEY)
      return res.status(503).json({error:"Google connection settings are incomplete. Configure the four GOOGLE_* environment variables in Vercel."});
    const state=crypto.randomBytes(32).toString("hex");
    const payload=Buffer.from(JSON.stringify({state,userId:user.id,createdAt:Date.now()})).toString("base64url");
    const signature=crypto.createHmac("sha256",process.env.APP_SESSION_SECRET||"").update(payload).digest("hex");
    res.setHeader("Set-Cookie","gosolo_google_oauth="+encodeURIComponent(payload+"."+signature)+"; Path=/api/google; HttpOnly; Secure; SameSite=Lax; Max-Age=600");
    const params=new URLSearchParams({
      client_id:clientId,redirect_uri:redirectUri,response_type:"code",scope:getGoogleScopes().join(" "),
      access_type:"offline",prompt:"consent",include_granted_scopes:"true",state
    });
    return res.status(200).json({success:true,authorizationUrl:"https://accounts.google.com/o/oauth2/v2/auth?"+params.toString()});
  }catch(error){return res.status(400).json({error:error.message||"Could not start Google connection."});}
}
