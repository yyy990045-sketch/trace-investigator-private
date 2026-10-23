/**
 * Smoke test built Vercel entrypoint without credentials or network access.
 * This is a route-contract check, not a claim that production SearchPro was called.
 */
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { strict as assert } from "node:assert";
const url=pathToFileURL(resolve("delivery/trace-showcase/api/investigate.js")).href;
const module=await import(url);
assert.equal(typeof module.default,"function","Vercel API default export must be callable");
function response(){
  const headers=new Map();
  return {
    statusCode:200,headers,body:"",
    setHeader(k,v){headers.set(k.toLowerCase(),v)},
    end(chunk){this.body+=chunk},
  };
}
const res=response();
await module.default({method:"GET",headers:{},socket:{remoteAddress:"127.0.0.1"}},res);
assert.equal(res.statusCode,200);
const state=JSON.parse(res.body);
assert.equal(state.live,false,"clean CI must fail closed without server secrets");
assert.equal(state.historyAvailable,true);
const post=response();
await module.default({
  method:"POST",headers:{"content-type":"application/json",origin:"https://example.org"},
  socket:{remoteAddress:"127.0.0.1"},
},post);
assert.equal(post.statusCode,503,"no public gateway until API + quotas + origin are configured");
assert.equal(JSON.parse(post.body).error,"LIVE_DISABLED");
console.log("TRACE serverless entry smoke passed: GET live=false, POST rejected with 503 in secret-free CI.");
