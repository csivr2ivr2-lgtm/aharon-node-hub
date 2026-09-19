import {config} from "./config.js";
import {ConnectorsClient} from "./clients/connectors.js";
import {WorkspaceClient} from "./clients/workspace.js";
export class SyncScheduler{
 constructor({hub,logger}){this.hub=hub;this.logger=logger;this.timer=null;this.running=false;this.connectors=new ConnectorsClient();this.workspace=new WorkspaceClient();}
 async runOnce(){
  if(this.running)return {ok:true,skipped:"already_running"};
  this.running=true;let imported=0,errors=0;
  try{
   const {events=[]}=await this.connectors.sync();
   for(const event of events){
    if(event.type==="sync.error"){errors++;this.logger.warn({source:event.source,account_id:event.account_id},"Connector sync error");continue;}
    try{
     if(event.type==="message"){const response=await this.workspace.call("message.ingest",event);if(response?.inserted)imported++;}
     else await this.workspace.call("activity.add",{event:"external."+String(event.type||"event"),entity_type:"integration",entity_id:String(event.account_id||""),title:String(event.title||event.type||"Event"),metadata:event});
     this.hub.publish("external.event",event);
    }catch(err){errors++;this.logger.warn({err,eventId:event.id},"Connector ingestion failed");}
   }
   return {ok:true,events:events.length,imported,errors};
  }finally{this.running=false;}
 }
 start(){if(!config.syncEnabled)return;const run=()=>this.runOnce().catch(err=>this.logger.error({err},"Connector sync failed"));this.timer=setInterval(run,config.syncIntervalSeconds*1000);this.timer.unref?.();setTimeout(run,1500).unref?.();}
 stop(){if(this.timer)clearInterval(this.timer);}
}
