import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { EmptyState } from "@personal/ui-core";
import type { RuntimeApi, DocumentBundle } from "@personal/capability-sdk";
/** App-owned module. Uses SDK only; does not change Registry, Engine or shared Shell. */
export function SourcesModule({
  client,
  projectId,
}: {
  client: RuntimeApi;
  projectId?: string;
}) {
  const q = useQuery({
    queryKey: ["source-runs", projectId],
    queryFn: () => client.runs(projectId),
  });
  return (
    <div className="page">
      <div className="page-title-row">
        <h1>实际资料来源</h1>
      </div>
      {q.isError ? (
        <p role="alert">{q.error.message}</p>
      ) : q.data?.length ? (
        <div className="actual-documents">
          {q.data.map((r) => (
            <article key={r.id}>
              <Link className="plain-link" to={"/missions/" + r.id}>
                {r.input.filename} · {r.id}
              </Link>
              {(
                (
                  r.steps.find((s) => (s.output as DocumentBundle | null)?.documents)?.output as
                    DocumentBundle | undefined
                )?.documents || []
              ).map((d) => (
                <details key={d.id}>
                  <summary>{d.source}</summary>
                  <p>{d.text}</p>
                </details>
              ))}
            </article>
          ))}
        </div>
      ) : (
        <EmptyState title="尚无真实资料" detail="先创建任务并上传授权资料。" />
      )}
    </div>
  );
}
