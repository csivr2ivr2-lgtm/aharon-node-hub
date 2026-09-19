const e=(k,d="")=>process.env[k]||d;
const b=(k,d=false)=>["1","true","yes","on"].includes(e(k,d?"true":"false").toLowerCase());
const n=(k,d)=>Math.max(1,parseInt(e(k,String(d)),10)||d);
const scopes=["openid","email","profile","https://www.googleapis.com/auth/gmail.readonly","https://www.googleapis.com/auth/gmail.send","https://www.googleapis.com/auth/calendar.readonly","https://www.googleapis.com/auth/drive.metadata.readonly"];
export const config=Object.freeze({
 env:e("NODE_ENV","production"),host:e("HOST","0.0.0.0"),port:n("PORT",3100),
 publicBaseUrl:e("PUBLIC_BASE_URL").replace(/\/$/,""),
 coreApiToken:e("CORE_API_TOKEN"),mcpApiToken:e("MCP_API_TOKEN"),
 workspaceBaseUrl:e("WORKSPACE_BASE_URL").replace(/\/$/,""),workspaceServiceToken:e("WORKSPACE_SERVICE_TOKEN"),
 vaultKey:e("CONNECTOR_VAULT_KEY"),oauthStateSecret:e("OAUTH_STATE_SECRET"),dataDir:e("DATA_DIR","./runtime"),
 googleClientId:e("GOOGLE_CLIENT_ID"),googleClientSecret:e("GOOGLE_CLIENT_SECRET"),
 googleRedirectUri:e("GOOGLE_REDIRECT_URI"),
 googleScopes:e("GOOGLE_SCOPES")?e("GOOGLE_SCOPES").split(",").map(x=>x.trim()).filter(Boolean):scopes,
 googleSyncQuery:e("GOOGLE_SYNC_QUERY","newer_than:2d"),googleSyncMaxResults:n("GOOGLE_SYNC_MAX_RESULTS",25),
 telegramBotToken:e("TELEGRAM_BOT_TOKEN"),httpTimeoutMs:n("HTTP_TIMEOUT_MS",20000),
 syncEnabled:b("SYNC_ENABLED",true),syncIntervalSeconds:Math.max(60,n("SYNC_INTERVAL_SECONDS",60)),
 mcpAllowWrites:b("MCP_ALLOW_WRITES",false),mcpAllowSensitiveWrites:b("MCP_ALLOW_SENSITIVE_WRITES",false)
});
export function assertConfig(){
 if(config.env!=="production")return;
 const missing=[];
 for(const [name,v] of [["CORE_API_TOKEN",config.coreApiToken],["MCP_API_TOKEN",config.mcpApiToken],
 ["WORKSPACE_SERVICE_TOKEN",config.workspaceServiceToken],["CONNECTOR_VAULT_KEY",config.vaultKey],
 ["OAUTH_STATE_SECRET",config.oauthStateSecret]])if(v.length<32||/^(CHANGE|YOUR_|EXAMPLE)/i.test(v))missing.push(name);
 if(!config.workspaceBaseUrl.startsWith("https://"))missing.push("WORKSPACE_BASE_URL");
 if(missing.length)throw Error("Missing or invalid configuration: "+missing.join(", "));
}
