import {getOperatorUserAndSubscription,getGoogleTokenRow} from "../../lib/google-oauth.js";
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="GET") return res.status(405).json({error:"Use GET."});
  try{const user=await getOperatorUserAndSubscription(req);const row=await getGoogleTokenRow(user.id);return res.status(200).json({connected:!!row,email:row?.google_email||null,connectedAt:row?.connected_at||null});}
  catch(error){return res.status(400).json({error:error.message||"Could not read Gmail status."});}
}
