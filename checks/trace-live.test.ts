import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { investigate, liveReady } from "../tooling/trace-live-api.ts";

const claim = "《个人信息保护法》自2021年8月20日起施行。";
const page = {
  id:"page_mock_real_shape",url:"https://example.org/law",title:"个人信息保护法施行日期",
  site:"测试公开原文",date:"2021-11-01",passage:"个人信息保护法于2021年8月20日通过，并于2021年11月1日开始施行。",
  score:0.99,
};
function fakeSearch(query:string){
  return {
    provider:"tencent-wsa",query,endpoint:"api.wsa.cloud.tencent.com",
    requestId:"mock-test-request",httpStatus:200,durationMs:12,attempts:1,
    resultCount:1,pages:[page],error:null,requestedAt:"2026-10-24T00:00:00Z",
  };
}
function fakeBody(url:string){
  return {
    url,finalUrl:url,ok:true,httpStatus:200,contentType:"text/html",
    bytes:300,text:"中华人民共和国个人信息保护法。2021年8月20日通过，2021年11月1日起施行。",
    title:"法律正文",reprintMarkers:[],error:null,
    fetchedAt:"2026-10-24T00:00:00Z",durationMs:10,
  };
}
const deps = { search: vi.fn(async(q:string)=>fakeSearch(q)) as any,
  source:vi.fn(async(url:string)=>fakeBody(url)) as any };
beforeEach(()=>{
  vi.stubEnv("TRACE_SNAPSHOT_SECRET", "a-32-byte-minimum-secret-that-is-for-tests-only");
  vi.stubEnv("PLATFORM_WSA_API_KEY", "");
  vi.stubEnv("UPSTASH_REDIS_REST_URL", "");
  deps.search.mockClear();deps.source.mockClear();
});
afterEach(()=>vi.unstubAllEnvs());

describe("公网实时调查链路：服务端真实接口契约（提供方仅在测试中模拟）",()=>{
  it("未配置密钥和限流设施时禁止开启公共实时搜索",()=>{
    expect(liveReady()).toBe(false);
  });
  it("每次搜索都保留请求记录、真实网页出处与正文/摘要状态",async()=>{
    const result=await investigate({claim,query:"个人信息保护法 施行日期"},deps);
    expect(deps.search).toHaveBeenCalledTimes(1);
    expect(deps.source).toHaveBeenCalledTimes(1);
    expect(result.rounds).toHaveLength(1);
    expect(result.rounds[0].requestId).toBe("mock-test-request");
    expect(result.sources.some(s=>s.url==="https://example.org/law")).toBe(true);
    expect(result.counts.pages).toBe(1);
    expect(result.counts.bodies).toBe(1);
    expect(result.statement).toContain("个人信息保护法");
    expect(typeof result.snapshot).toBe("string");
  });
  it("继续追查必须验证前轮证据签名，并重新核对累计来源",async()=>{
    const first=await investigate({claim,query:"个人信息保护法 通过时间"},deps);
    const second=await investigate({claim,query:"个人信息保护法 自何时施行",snapshot:first.snapshot},deps);
    expect(second.rounds).toHaveLength(2);
    expect(deps.search).toHaveBeenCalledTimes(2);
    expect(second.counts.pages).toBe(1); // URL 去重
    expect(second.mayContinue).toBe(true);
    await expect(investigate({claim,query:"个人信息保护法 施行",snapshot:first.snapshot+"x"},deps))
      .rejects.toThrow(/修改|签名/);
  });
  it("用户询问两组数字为何不同，保留来源对照并拒绝臆造差异原因",async()=>{
    const question="为什么2024年中国新能源汽车产量有1288.8万辆和1316.8万辆两种说法？";
    const items=[
      { ...page,id:"statistics",url:"https://example.org/statistics",site:"国家统计局",
        passage:"国家统计局发布：2024年中国新能源汽车产量1316.8万辆，同比增长38.7%。" },
      { ...page,id:"association",url:"https://example.org/association",site:"中国汽车工业协会",
        passage:"中国汽车工业协会发布：2024年我国新能源汽车产量1288.8万辆，同比增长34.4%。" },
    ];
    const testDeps={
      search:vi.fn(async(query:string)=>({
        ...fakeSearch(query),resultCount:2,pages:items,
      })) as any,
      source:vi.fn(async(url:string)=>({
        ...fakeBody(url),text:url.includes("statistics")?items[0].passage:items[1].passage,
      })) as any,
    };
    const result=await investigate({claim:question,query:"2024 新能源汽车产量 国家统计局 中汽协"},testDeps);
    expect(result.outcome).toBe("insufficient");
    expect(result.statement).toContain("差异原因尚未核实");
    expect(result.kind).toBe("comparison");
    expect(result.figures.length).toBeGreaterThanOrEqual(2);
    expect(result.figures.map(x=>x.value)).toContain(1316.8);
    expect(result.figures.map(x=>x.value)).toContain(1288.8);
  });
  it("无搜索结果时只能给证据不足，不得编造来源",async()=>{
    const empty={search:vi.fn(async(query:string)=>({
      ...fakeSearch(query),pages:[],resultCount:0,
      error:{code:"SEARCH_PROVIDER_ERROR",message:"没有结果",retryable:false},
    })) as any,source:deps.source};
    const result=await investigate({claim,query:"个人信息保护法"},empty);
    expect(result.outcome).toBe("insufficient");
    expect(result.sources).toHaveLength(0);
    expect(result.counts.pages).toBe(0);
  });
  it("对待上传与返回的数据遮蔽网页里的手机号",async()=>{
    const phonePage={...page,id:"page_phone",passage:"2021年11月1日起施行，联系电话13800138000"};
    const privateDeps={search:vi.fn(async(query:string)=>({
      ...fakeSearch(query),pages:[phonePage],
    })) as any,source:vi.fn(async(url:string)=>({
      ...fakeBody(url),text:"2021年11月1日起施行，电话13800138000",
    })) as any};
    const result=await investigate({claim,query:"个人信息保护法 施行日期"},privateDeps);
    expect(result.snapshot).not.toMatch(/13800138000/);
    expect(JSON.stringify(result.sources)).not.toContain("13800138000");
  });
});
