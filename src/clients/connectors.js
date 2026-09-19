import {config} from "../config.js";
import {EncryptedVault} from "../connectors/vault.js";
import {GoogleConnector} from "../connectors/google.js";
const vault=new EncryptedVault();
const google=new GoogleConnector(vault);
export const googleConnector=google;
function clamp(n,max=50){return Math.min(max,Math.max(1,Number(n||20)));}
export class ConnectorsClient{
 configured(){return true;}
 async status(){return {ok:true,connectors:[
  {key:"google",configured:google.configured(),accounts:google.configured()?await google.accounts():[]},
  {key:"telegram",configured:Boolean(config.telegramBotToken),mode:"bot"},
  {key:"whatsapp",configured:false,status:"deferred"},
  {key:"messenger",configured:false,status:"deferred"}
 ]};}
 async get(path){
  if(path==="/v1/connectors")return this.status();
  if(path==="/v1/google/accounts")return {ok:true,accounts:await google.accounts()};
  if(path==="/v1/whatsapp/status")return {ok:true,configured:false,status:"deferred"};
  throw Error("Unsupported connector route");
 }
 async post(path,params={}){
  if(path==="/v1/google/auth-url")return {ok:true,url:google.authUrl(String(params.account_hint||""))};
  if(path==="/v1/google/gmail/recent")return google.gmailRecent(params);
  if(path==="/v1/google/calendar/upcoming")return google.calendarUpcoming(params);
  if(path==="/v1/google/drive/search")return google.driveSearch(params);
  if(path==="/v1/google/gmail/send")return google.sendEmail(params);
  if(path==="/v1/sync")return this.sync();
  throw Error("Unsupported connector route");
 }
 async sync(){return {ok:true,events:google.configured()?await google.sync():[],generated_at:new Date().toISOString()};}
}
