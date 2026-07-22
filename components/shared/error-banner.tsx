import type { WorkspaceError } from "@/lib/workspace/workspace-reducer";

interface ErrorBannerProps {
  error: WorkspaceError | null;
  saved: boolean;
  onRetryAnalysis: () => void;
  onRetrySave: () => void;
  retrying?: boolean;
}

export function ErrorBanner({
  error,
  saved,
  onRetryAnalysis,
  onRetrySave,
  retrying = false,
}: ErrorBannerProps) {
  if (!error && saved) return null;

  return (
    <div
      role="alert"
      className="border-l-4 border-annotation bg-[#fff4f2] px-4 py-3 text-sm text-ink"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-semibold">
            {!saved ? "结果尚未保存" : "本轮对话未完成"}
          </p>
          <p className="mt-1 leading-6 text-muted">
            {error?.message ?? "请重试保存当前结果。"}
          </p>
          {error?.code ? (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.14em] text-annotation">
              {error.code}
            </p>
          ) : null}
        </div>
        {error?.retryable && error.action ? (
          <button
            type="button"
            className="min-h-11 border border-annotation px-4 font-semibold text-annotation transition-colors hover:bg-annotation hover:text-white disabled:cursor-wait disabled:opacity-60"
            disabled={retrying}
            onClick={
              error.action === "retry_save" ? onRetrySave : onRetryAnalysis
            }
          >
            {retrying
              ? error.action === "retry_save"
                ? "正在保存"
                : "正在重新生成"
              : error.action === "retry_save"
                ? "重试保存"
                : "重新生成"}
          </button>
        ) : null}
      </div>
    </div>
  );
}
