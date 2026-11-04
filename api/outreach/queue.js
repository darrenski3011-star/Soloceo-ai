import {getOperatorUserAndSubscription} from "../../lib/google-oauth.js";
import {operatorStore} from "../../lib/operator-store.js";
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({error:"Use POST."});
  try{
    const user=await getOperatorUserAndSubscription(req);
    const b=req.body||{},recipient=String(b.recipientEmail||"").trim().toLowerCase(),subject=String(b.subject||"").trim().slice(0,180),body=String(b.body||"").trim().slice(0,12000);
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)||!subject||!body) return res.status(400).json({error:"A valid recipient email, subject and message are required."});
    const rows=await operatorStore("/rest/v1/gosolo_outreach_queue?select=id",{method:"POST",headers:{Prefer:"return=representation"},body:JSON.stringify({user_id:user.id,prospect:b.prospect||{},recipient_email:recipient,subject,body,status:"pending_approval"})});
    return res.status(201).json({success:true,approval:rows?.[0],status:"pending_approval",message:"Saved for your approval. No email has been sent."});
  }catch(error){return res.status(400).json({error:error.message||"Could not queue outreach."});}
}
