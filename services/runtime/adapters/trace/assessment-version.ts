import { createHash } from "node:crypto";

export const TRACE_RULES_VERSION = "2026-10-25-evidence-entity-v2";

function canonical(value: any): any {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  return value ?? null;
}

/** Only user-visible judgments/evidence, not read timestamps or derived display helpers. */
export function assessmentFingerprint(assessment: any): string {
  const facts = (assessment?.facts || []).map((f: any) => ({
    factId: f.factId, fact: f.fact, relation: f.relation,
    reasons: f.reasons || [],
    sources: (f.sources || []).map((s: any) => ({
      pageId: s.pageId, url: s.url, title: s.title || "", site: s.site || "", date: s.date || "",
      excerpt: s.excerpt || "", bodyExcerpt: s.bodyExcerpt || null,
      relation: s.relation, reasons: s.reasons || [],
      keySentence: s.keySentence || null, keySentenceFrom: s.keySentenceFrom || null,
      bodyStatus: s.bodyStatus, scopeCompatible: s.scopeCompatible ?? true, scopeNote: s.scopeNote || "",
      dateStatus: s.dateStatus, dateNote: s.dateNote || "", independence: s.independence,
      quantityEvidence: s.quantityEvidence || [], semantic: s.semantic || null,
    })).sort((a: any, b: any) => a.pageId.localeCompare(b.pageId)),
  })).sort((a: any, b: any) => a.factId.localeCompare(b.factId));
  return createHash("sha256").update(JSON.stringify(canonical({
    facts, verdict: assessment?.verdict || null,
    lookupAnswer: assessment?.lookup?.answer || null,
    openQuestions: assessment?.openQuestions || [],
  }))).digest("hex");
}

export function versionAssessment<T>(assessment: T) {
  return { ...assessment, rulesVersion: TRACE_RULES_VERSION, comparisonFingerprint: assessmentFingerprint(assessment) };
}

export function assessmentChanged(previous: any, current: any) {
  return !previous || assessmentFingerprint(previous) !== assessmentFingerprint(current);
}
