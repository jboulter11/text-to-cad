import { useEffect, useState } from "react";
import { ChevronRight, Folder } from "lucide-react";
import { TreeFilterInput } from "@cad/ui/primitives/tree-filter";
import { useI18n } from "@cad/ui/i18n";
import { compareExplorerRows, ExplorerSort } from "./ExplorerSort.jsx";
import type { FileEntry, FileSource, RecentDocument } from "../types.js";

type Listing = NonNullable<FileSource["list"]>;
type Expansion = { expanded: ReadonlySet<string>; onExpandedChange(key: string, open: boolean): void };
type Open = (model: string, toolpath?: string, showToolpath?: boolean) => void;
type Project = { name: string; modified?: number; printed?: FileEntry; models: RecentDocument[] };
const isSlice = (name: string) => /\.gcode(?:\.3mf)?$/i.test(name);
const isModel = (name: string) => !isSlice(name) && /\.(?:3mf|stl|step|stp|xbf|glb|obj)$/i.test(name);
const groupStyle = "group flex w-full cursor-pointer list-none items-center gap-1.5 rounded-sm px-2 py-1 text-left text-xs hover:bg-sidebar-accent [&::-webkit-details-marker]:hidden";
const entryStyle = "flex w-full items-center truncate rounded-sm px-2 py-1 text-left text-xs hover:bg-sidebar-accent aria-[current=true]:bg-accent aria-[current=true]:text-accent-foreground";

function useEntries(list: Listing, path?: string) {
  const [state, setState] = useState<{ path: string; entries?: readonly FileEntry[] }>({ path: "" });
  useEffect(() => {
    if (!path) return;
    const controller = new AbortController();
    void list(path, { signal: controller.signal, toolpaths: true }).then(entries => {
      if (!controller.signal.aborted) setState({ path, entries });
    }, () => {
      if (!controller.signal.aborted) setState({ path });
    });
    return () => controller.abort();
  }, [list, path]);
  return state.path === path ? state.entries ?? null : undefined;
}

function Artifacts({ entries, onOpen, activePath }: { entries: readonly FileEntry[]; onOpen: Open; activePath: string }) {
  const models = entries.filter(entry => isModel(entry.name));
  const slices = entries.filter(entry => isSlice(entry.name));
  const modelFor = (slice: FileEntry) => {
    const base = slice.name.replace(/\.gcode(?:\.3mf)?$/i, "").toLowerCase();
    const exact = models.find(model => base === model.name.replace(/\.[^.]+$/, "").toLowerCase());
    return exact ?? (models.length === 1 ? models[0] : undefined);
  };
  return <>
    {models.map(model => <button key={model.path} className={entryStyle} title={model.name} aria-current={model.path === activePath || undefined}
      onClick={() => onOpen(model.path, slices.find(slice => modelFor(slice) === model)?.path)}>{model.name}</button>)}
    {slices.map(slice => <button key={slice.path} className={entryStyle} title={slice.name} aria-current={slice.path === activePath || undefined}
      onClick={() => onOpen(modelFor(slice)?.path ?? "", slice.path, true)}>{slice.name}</button>)}
  </>;
}

function Version({ name, path, files, list, onOpen, open, setOpen, activePath }: {
  name: string; path?: string; files?: FileEntry[]; list: Listing; onOpen: Open; activePath: string; open: boolean; setOpen(open: boolean): void;
}) {
  const { t } = useI18n();
  const entries = useEntries(list, open ? path : undefined);
  return <details open={open} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary className={groupStyle}><ChevronRight className="size-3 shrink-0 group-open:rotate-90" />{name}</summary>
    {open && <div className="pl-3">
      {files || entries ? <Artifacts entries={files ?? entries ?? []} onOpen={onOpen} activePath={activePath} />
        : <p className="m-2 text-xs text-muted-foreground">{t(entries === null ? "explorer.readFailed" : "explorer.loading")}</p>}
    </div>}
  </details>;
}

function ProjectRow({ project, list, onOpen, sort, expanded, onExpandedChange, activePath }: {
  project: Project; list: Listing; onOpen: Open; sort: string; activePath: string;
} & Expansion) {
  const { t, locale } = useI18n();
  const open = expanded.has(project.name);
  const entries = useEntries(list, open ? project.printed?.path : undefined);
  const releases = entries?.find(entry => entry.kind === "directory" && entry.name === "releases");
  const saved = useEntries(list, releases?.path);
  const versions = new Map<string, { path?: string; files?: FileEntry[]; modified?: number }>();
  const loose: FileEntry[] = [];
  for (const entry of saved ?? []) {
    if (entry.kind === "directory" && /^v\d+$/i.test(entry.name)) versions.set(entry.name.toLowerCase(), { path: entry.path, modified: entry.modified });
  }
  for (const entry of entries ?? []) {
    if (entry.kind !== "file") continue;
    const version = entry.name.match(/_v(\d+)(?=[_.-])/i)?.[1];
    if (!version) { loose.push(entry); continue; }
    const key = "v" + version;
    const group = versions.get(key);
    if (group?.path) continue;
    if (group?.files) {
      group.files.push(entry);
      group.modified = Math.max(group.modified ?? 0, entry.modified ?? 0);
    } else versions.set(key, { files: [entry], modified: entry.modified });
  }
  const groups = [...versions].map(([name, version]) => ({
    name, modified: version.modified,
    node: <Version key={name} name={name} list={list} onOpen={onOpen} activePath={activePath} {...version}
      open={expanded.has(`${project.name}/${name}`)} setOpen={value => onExpandedChange(`${project.name}/${name}`, value)} />,
  }));
  if (project.models.length) {
    const working = t("explorer.working");
    groups.push({
      name: working,
      modified: Math.max(...project.models.map(model => model.updated ?? 0)),
      node: <details key="working" open={expanded.has(`${project.name}/working`)}
        onToggle={event => onExpandedChange(`${project.name}/working`, event.currentTarget.open)}>
        <summary className={groupStyle}><ChevronRight className="size-3 shrink-0" />{working}</summary>
        <div className="pl-3">
          {project.models.map(model => <button key={model.path} className={entryStyle} aria-current={model.path === activePath || undefined}
            onClick={() => onOpen(model.path)}>{model.name}</button>)}
        </div>
      </details>,
    });
  }
  groups.sort(compareExplorerRows(sort, locale));
  return <details open={open} onToggle={event => onExpandedChange(project.name, event.currentTarget.open)}>
    <summary className={groupStyle} data-project-row="">
      <ChevronRight className="size-3 shrink-0 group-open:rotate-90" /><Folder className="size-3.5 shrink-0" />
      <span className="truncate">{project.name}</span>
    </summary>
    {open && <div className="pl-3">
      {groups.map(group => group.node)}
      <Artifacts entries={loose} onOpen={onOpen} activePath={activePath} />
      {project.printed && !entries && <p className="m-2 text-xs text-muted-foreground">{t(entries === null ? "explorer.readFailed" : "explorer.loading")}</p>}
    </div>}
  </details>;
}

export function ProjectsList({ root, list, recent, onOpen, expanded, onExpandedChange, activePath }: {
  root: string;
  list: Listing;
  recent?: { list(): Promise<readonly RecentDocument[]> };
  onOpen: Open;
  activePath: string;
} & Expansion) {
  const { t, locale } = useI18n();
  const [sort, setSort] = useState("modified");
  const [query, setQuery] = useState("");
  const [models, setModels] = useState<readonly RecentDocument[]>([]);
  const printed = useEntries(list, "/prints");
  useEffect(() => {
    let active = true;
    void recent?.list().then(found => { if (active) setModels(found); }, () => {});
    return () => { active = false; };
  }, [recent]);
  const projects = new Map<string, Project>();
  for (const entry of printed ?? []) {
    if (entry.kind === "directory") projects.set(entry.name, { name: entry.name, modified: entry.modified, printed: entry, models: [] });
  }
  const prefix = root.replace(/\/$/, "") + "/";
  for (const model of models) {
    if (model.kind !== "model" || model.missing || !model.script?.startsWith(prefix)) continue;
    const relative = model.script.slice(prefix.length);
    const name = relative.split("/")[0];
    if (!relative.includes("/")) continue;
    const project = projects.get(name) ?? { name, models: [] };
    project.models.push(model);
    project.modified = Math.max(project.modified ?? 0, model.updated ?? 0);
    projects.set(name, project);
  }
  const rows = [...projects.values()].filter(project => project.name.toLowerCase().includes(query.trim().toLowerCase()))
    .sort(compareExplorerRows(sort, locale));
  return <div className="flex min-h-0 flex-1 flex-col" data-project-list="">
    <ExplorerSort value={sort} onChange={setSort} />
    <TreeFilterInput label={t("explorer.filterProjects")} placeholder={t("explorer.filterProjects")} value={query}
      onChange={setQuery} onKeyDown={undefined} inputRef={undefined} trailing={undefined} clearLabel={undefined} className={undefined} />
    <div className="min-h-0 flex-1 overflow-y-auto p-1">
      {rows.map(project => <ProjectRow key={project.name} project={project} sort={sort} list={list} onOpen={onOpen}
        expanded={expanded} onExpandedChange={onExpandedChange} activePath={activePath} />)}
      {!rows.length && <p className="m-2 text-xs text-muted-foreground">{t(printed === undefined ? "explorer.loading" : "explorer.noMatches")}</p>}
    </div>
  </div>;
}
