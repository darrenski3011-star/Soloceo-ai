import {getOperatorUserAndSubscription} from "../../lib/google-oauth.js";
import {operatorStore} from "../../lib/operator-store.js";
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({error:"Use POST."});
  try{
    const user=await getOperatorUserAndSubscription(req),id=String(req.body?.id||"");
    if(!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({error:"A valid outreach approval ID is required."});
    const rows=await operatorStore("/rest/v1/gosolo_outreach_queue?select=id,status&id=eq."+encodeURIComponent(id)+"&user_id=eq."+encodeURIComponent(user.id));
    if(!rows?.length) return res.status(404).json({error:"Approval item not found."});
    if(rows[0].status!=="pending_approval") return res.status(409).json({error:"This outreach item is no longer awaiting approval."});
    const updated=await operatorStore("/rest/v1/gosolo_outreach_queue?id=eq."+encodeURIComponent(id)+"&user_id=eq."+encodeURIComponent(user.id),{method:"PATCH",headers:{Prefer:"return=representation"},body:JSON.stringify({status:"approved",approved_at:new Date().toISOString(),updated_at:new Date().toISOString()})});
    return res.status(200).json({success:true,approval:updated?.[0],message:"Approved. This only authorizes sending; the email has not been sent yet."});
  }catch(error){return res.status(400).json({error:error.message||"Could not approve outreach."});}
}
