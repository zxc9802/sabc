import type { ProjectRecord } from "@/lib/storage/db";

interface ProjectListProps {
  projects: ProjectRecord[];
  selectedId: string | null;
  onSelect: (projectId: string) => void;
  onDelete: (projectId: string) => void;
  onCompare: () => void;
  onNew: () => void;
}

const statusLabel: Record<ProjectRecord["status"], string> = {
  draft: "草稿",
  provisional: "临时",
  final: "已定级",
};

export function ProjectList({
  projects,
  selectedId,
  onSelect,
  onDelete,
  onCompare,
  onNew,
}: ProjectListProps) {
  return (
    <section aria-labelledby="dossier-index-title" className="h-full bg-sheet">
      <div className="flex items-end justify-between border-b border-line px-4 py-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted">
            Dossier index
          </p>
          <h2 id="dossier-index-title" className="mt-1 font-display text-xl font-semibold">
            案卷索引
          </h2>
        </div>
        <span className="font-mono text-xs text-muted">{projects.length}</span>
      </div>

      {projects.length === 0 ? (
        <div className="px-4 py-8 text-sm leading-6 text-muted">
          <p className="font-medium text-ink">还没有历史项目</p>
          <p className="mt-1">完成第一次评估后，案卷会保存在当前浏览器。</p>
        </div>
      ) : (
        <ul className="divide-y divide-line/70">
          {projects.map((project) => (
            <li key={project.id} className="group relative">
              <button
                type="button"
                aria-current={selectedId === project.id ? "page" : undefined}
                className="min-h-20 w-full px-4 py-3 pr-12 text-left transition-colors hover:bg-paper aria-[current=page]:bg-[#e9efff]"
                onClick={() => onSelect(project.id)}
              >
                <span className="block truncate text-sm font-semibold">{project.name}</span>
                <span className="mt-2 flex items-center justify-between gap-2 font-mono text-[10px] text-muted">
                  <span>{statusLabel[project.status]}</span>
                  <time dateTime={project.updatedAt}>
                    {new Date(project.updatedAt).toLocaleDateString("zh-CN")}
                  </time>
                </span>
              </button>
              <button
                type="button"
                aria-label={`删除 ${project.name}`}
                className="absolute right-1 top-1 min-h-11 min-w-11 text-muted opacity-70 hover:text-annotation focus:opacity-100 group-hover:opacity-100"
                onClick={() => onDelete(project.id)}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 border-t border-line p-4">
        <button
          type="button"
          className="min-h-11 w-full bg-decision px-3 text-sm font-semibold text-white hover:bg-ink"
          onClick={onNew}
        >
          新建案卷
        </button>
        <button
          type="button"
          className="min-h-11 w-full border border-ink px-3 text-sm font-semibold transition-colors hover:bg-ink hover:text-white disabled:cursor-not-allowed disabled:border-line disabled:text-muted disabled:hover:bg-transparent"
          disabled={projects.length < 2}
          onClick={onCompare}
        >
          对比项目
        </button>
      </div>
    </section>
  );
}
