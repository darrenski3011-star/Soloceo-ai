import {getOperatorUserAndSubscription,getGoogleAccessToken} from "../../lib/google-oauth.js";
import {operatorStore} from "../../lib/operator-store.js";
function b64url(s){return Buffer.from(s,"utf8").toString("base64").replace(/=/g,"").replace(/\+/g,"-").replace(/\//g,"_");}
export default async function handler(req,res){
  res.setHeader("Cache-Control","no-store");
  if(req.method!=="POST") return res.status(405).json({error:"Use POST."});
  try{
    const user=await getOperatorUserAndSubscription(req),id=String(req.body?.id||"");
    if(!/^[0-9a-f-]{36}$/i.test(id)) return res.status(400).json({error:"A valid approved outreach ID is required."});
    const rows=await operatorStore("/rest/v1/gosolo_outreach_queue?select=*&id=eq."+encodeURIComponent(id)+"&user_id=eq."+encodeURIComponent(user.id));
    const item=rows?.[0];
    if(!item) return res.status(404).json({error:"Outreach item not found."});
    if(item.status!=="approved") return res.status(409).json({error:"This email must be explicitly approved before it can be sent."});
    const {accessToken}=await getGoogleAccessToken(user.id);
    const message=["To: "+item.recipient_email,"Subject: "+item.subject,"MIME-Version: 1.0","Content-Type: text/plain; charset=UTF-8","Content-Transfer-Encoding: 8bit","","",item.body].join("\r\n");
    const response=await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send",{method:"POST",headers:{Authorization:"Bearer "+accessToken,"Content-Type":"application/json"},body:JSON.stringify({raw:b64url(message)})});
    const data=await response.json().catch(()=>({}));
    if(!response.ok){await operatorStore("/rest/v1/gosolo_outreach_queue?id=eq."+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({status:"failed",error_message:String(data.error?.message||"Gmail send failed").slice(0,500),updated_at:new Date().toISOString()})});return res.status(502).json({error:"Gmail could not send this approved message. "+(data.error?.message||"Reconnect Gmail and retry.")});}
    await operatorStore("/rest/v1/gosolo_outreach_queue?id=eq."+encodeURIComponent(id),{method:"PATCH",body:JSON.stringify({status:"sent",sent_at:new Date().toISOString(),provider_message_id:data.id||null,updated_at:new Date().toISOString()})});
    return res.status(200).json({success:true,status:"sent",messageId:data.id});
  }catch(error){return res.status(400).json({error:error.message||"Could not send approved outreach."});}
}
