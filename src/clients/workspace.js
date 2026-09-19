import {config} from "../config.js";
import {jsonRequest} from "../http.js";
const read=new Set(["status","search","project.list","project.get","client.list","client.get","system.list","system.get","task.list","activity.list","conversation.list","account.list"]);
const writes=new Set(["task.create","task.update","message.ingest","activity.add"]);
export class WorkspaceClient{
 constructor(){this.baseUrl=config.workspaceBaseUrl;this.token=config.workspaceServiceToken;}
 call(op,params={}){if(!read.has(op)&&!writes.has(op))throw Error("Unknown Workspace operation");return jsonRequest(this.baseUrl+"/api/service.php?op="+encodeURIComponent(op),{method:"POST",token:this.token,body:params});}
 status(){return this.call("status");}search(q,limit=25){return this.call("search",{q,limit});}
}
