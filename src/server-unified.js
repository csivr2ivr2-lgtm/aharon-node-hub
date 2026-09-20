import Fastify from "fastify";
import {config,assertConfig} from "./config.js";
import {bearerToken,equalToken} from "./http.js";
import {WorkspaceClient} from "./clients/workspace.js";
import {ConnectorsClient,googleConnector} from "./clients/connectors.js";
import {RealtimeHub} from "./realtime.js";
import {SyncScheduler} from "./scheduler.js";
import {handleMcp} from "./mcp.js";
import {registerSearchBackendRoutes} from "../apps/search/backend/routes.js";
assertConfig();
const app=Fastify({logger:{level:config.env==="production"?"info":"debug",redact:["req.headers.authorization","*.token","*.secret","*.api_key","*.access_token","*.refresh_token"]},bodyLimit:2097152});
const workspace=new WorkspaceClient(),connectors=new ConnectorsClient();
const hub=new RealtimeHub(app.server),scheduler=new SyncScheduler({hub,logger:app.log});
function admin(req,reply){if(!equalToken(bearerToken(req),config.coreApiToken)){reply.code(401).send({ok:false,error:"unauthorized"});return false;}return true;}
function esc(x){return String(x).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[c]));}
app.get("/health",async()=>{
 let workspaceOk=false;try{workspaceOk=Boolean((await workspace.status())?.ok);}catch{}
 return {ok:workspaceOk,service:"aharon-node-hub",workspace:workspaceOk?"up":"down",google:googleConnector.configured()?"configured":"not_configured"};
});
app.get("/v1/status",async(req,reply)=>{if(!admin(req,reply))return;return {ok:true,workspace:await workspace.status(),connectors:await connectors.status(),permissions:{mcp_writes:config.mcpAllowWrites,sensitive_writes:config.mcpAllowSensitiveWrites}};});
app.post("/v1/search",async(req,reply)=>{if(!admin(req,reply))return;const q=String(req.body?.q||"").trim();if(!q)return reply.code(422).send({error:"q_required"});return workspace.search(q,Math.min(50,Math.max(1,Number(req.body?.limit||25))));});
app.post("/v1/ws-ticket",async(req,reply)=>{if(!admin(req,reply))return;return {ok:true,ticket:hub.issueTicket(),expires_in:60};});
app.get("/v1/connectors",async(req,reply)=>{if(!admin(req,reply))return;return connectors.status();});
app.post("/v1/connectors/google/auth-url",async(req,reply)=>{if(!admin(req,reply))return;if(!googleConnector.configured())return reply.code(503).send({error:"google_not_configured"});return {ok:true,url:googleConnector.authUrl(String(req.body?.account_hint||""))};});
app.get("/v1/connectors/google/accounts",async(req,reply)=>{if(!admin(req,reply))return;return connectors.get("/v1/google/accounts");});
app.post("/v1/google/gmail/recent",async(req,reply)=>{if(!admin(req,reply))return;return connectors.post("/v1/google/gmail/recent",req.body||{});});
app.post("/v1/google/calendar/upcoming",async(req,reply)=>{if(!admin(req,reply))return;return connectors.post("/v1/google/calendar/upcoming",req.body||{});});
app.post("/v1/google/drive/search",async(req,reply)=>{if(!admin(req,reply))return;return connectors.post("/v1/google/drive/search",req.body||{});});
app.post("/v1/google/gmail/send",async(req,reply)=>{if(!admin(req,reply))return;return connectors.post("/v1/google/gmail/send",req.body||{});});
app.get("/oauth/google/callback",async(req,reply)=>{
 try{const code=String(req.query?.code||""),state=String(req.query?.state||"");if(!code||!state)return reply.code(400).type("text/plain").send("Missing OAuth code/state");const account=await googleConnector.callback(code,state);
 return reply.type("text/html; charset=utf-8").send('<!doctype html><meta charset="utf-8"><title>Google connected</title><h1>Google connected</h1><p>'+esc(account.email||account.name)+'</p><p>You can close this window.</p>');
 }catch(error){req.log.error({err:error},"OAuth callback failed");return reply.code(400).type("text/plain").send("Google account connection failed.");}
});
app.post("/v1/sync",async(req,reply)=>{if(!admin(req,reply))return;return scheduler.runOnce();});
app.all("/mcp",handleMcp);
await registerSearchBackendRoutes(app);
await app.listen({host:config.host,port:config.port});scheduler.start();
app.log.info({port:config.port},"Single-process Aharon Node Hub started");
let closing=false;
async function stop(){if(closing)return;closing=true;scheduler.stop();hub.close();await app.close();process.exit(0);}
process.on("SIGTERM",stop);process.on("SIGINT",stop);