"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Archive, ArchiveRestore, Ellipsis, FolderKanban, Pencil, Plus, Tag, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { SWATCHES } from "@/lib/constants";
import { useCategories, useDeleteCategory, useDeleteProject, useProjects, useTasks, useUpsertCategory, useUpsertProject } from "@/lib/queries";
import type { Project } from "@/lib/types";
import { cn } from "@/lib/utils";

const NONE = "__none";

function ColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Color">
      {SWATCHES.map((c) => (
        <button key={c} type="button" role="radio" aria-checked={value === c} aria-label={c} onClick={() => onChange(c)}
          className={cn("size-7 rounded-full ring-offset-2 ring-offset-background transition", value === c && "ring-2 ring-foreground/60")} style={{ background: c }} />
      ))}
    </div>
  );
}

function ProjectDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (o: boolean) => void; project?: Project }) {
  const { data: categories } = useCategories();
  const upsert = useUpsertProject();
  const [f, setF] = useState({ name: "", description: "", color: SWATCHES[0], category_id: NONE });
  useEffect(() => {
    if (open) setF({ name: project?.name ?? "", description: project?.description ?? "", color: project?.color ?? SWATCHES[0], category_id: project?.category_id ?? NONE });
  }, [open, project]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{project ? "Edit project" : "New project"}</DialogTitle><DialogDescription>Group related tasks together.</DialogDescription></DialogHeader>
        <form className="grid gap-4" onSubmit={async (e) => {
          e.preventDefault();
          if (!f.name.trim()) return;
          await upsert.mutateAsync({ id: project?.id, name: f.name.trim(), description: f.description || null, color: f.color, category_id: f.category_id === NONE ? null : f.category_id, archived_at: project?.archived_at ?? null });
          toast.success(project ? "Project saved" : "Project created");
          onOpenChange(false);
        }}>
          <div className="grid gap-1.5"><Label htmlFor="p-name">Name</Label><Input id="p-name" autoFocus value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
          <div className="grid gap-1.5"><Label htmlFor="p-desc">Description</Label><Textarea id="p-desc" rows={2} value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
          <div className="grid gap-1.5">
            <Label>Category</Label>
            <Select value={f.category_id} onValueChange={(v) => setF({ ...f, category_id: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value={NONE}>No category</SelectItem>{categories?.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="grid gap-1.5"><Label>Color</Label><ColorPicker value={f.color} onChange={(color) => setF({ ...f, color })} /></div>
          <DialogFooter><Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button type="submit">Save</Button></DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default function ProjectsPage() {
  const { data: projects, isLoading } = useProjects();
  const { data: tasks } = useTasks();
  const { data: categories } = useCategories();
  const upsert = useUpsertProject();
  const del = useDeleteProject();
  const upsertCat = useUpsertCategory();
  const delCat = useDeleteCategory();
  const [dlg, setDlg] = useState<{ open: boolean; project?: Project }>({ open: false });
  const [showArchived, setShowArchived] = useState(false);
  const [catName, setCatName] = useState("");
  const [catColor, setCatColor] = useState(SWATCHES[1]);

  const counts = useMemo(() => {
    const m = new Map<string, { open: number; done: number; overdue: number }>();
    for (const t of tasks ?? []) {
      if (!t.project_id || t.status === "cancelled") continue;
      const c = m.get(t.project_id) ?? { open: 0, done: 0, overdue: 0 };
      if (t.status === "completed") c.done++; else c.open++;
      if (t.status === "overdue") c.overdue++;
      m.set(t.project_id, c);
    }
    return m;
  }, [tasks]);
  const list = (projects ?? []).filter((p) => (showArchived ? !!p.archived_at : !p.archived_at));

  return (
    <div className="flex flex-col gap-10">
      <div>
        <PageHeader title="Projects" description="Organise tasks by project and category."
          actions={<>
            <Button size="sm" variant="ghost" onClick={() => setShowArchived((s) => !s)}>{showArchived ? "Active projects" : "Archived"}</Button>
            <Button size="sm" onClick={() => setDlg({ open: true })}><Plus />New project</Button>
          </>} />
        {!isLoading && list.length === 0 && <EmptyState icon={<FolderKanban />} title={showArchived ? "No archived projects" : "No projects yet"} description="Projects group related tasks — a course, a client, a launch." action={!showArchived && <Button size="sm" onClick={() => setDlg({ open: true })}><Plus />Create project</Button>} />}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((p) => {
            const c = counts.get(p.id) ?? { open: 0, done: 0, overdue: 0 };
            const total = c.open + c.done;
            const cat = categories?.find((x) => x.id === p.category_id);
            return (
              <Card key={p.id} className="group flex flex-col gap-3 p-4">
                <div className="flex items-start justify-between gap-2">
                  <Link href={`/tasks?project=${p.id}`} className="flex min-w-0 items-center gap-2.5 hover:text-primary">
                    <span className="size-3 shrink-0 rounded" style={{ background: p.color }} />
                    <span className="truncate font-medium">{p.name}</span>
                  </Link>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" className="opacity-60 group-hover:opacity-100" aria-label="Project actions"><Ellipsis /></Button></DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setDlg({ open: true, project: p })}><Pencil />Edit</DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => upsert.mutate({ ...p, archived_at: p.archived_at ? null : new Date().toISOString() })}>
                        {p.archived_at ? <><ArchiveRestore />Unarchive</> : <><Archive />Archive</>}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => confirm(`Delete project “${p.name}”? Its tasks are kept without a project.`) && del.mutate(p.id)}><Trash2 />Delete</DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {p.description && <p className="line-clamp-2 text-[13px] text-muted-foreground">{p.description}</p>}
                <div>
                  <div className="mb-1.5 flex justify-between text-xs text-muted-foreground"><span>{c.done}/{total} done{c.overdue ? ` · ${c.overdue} overdue` : ""}</span><span className="tabular">{total ? Math.round((c.done / total) * 100) : 0}%</span></div>
                  <Progress value={total ? (c.done / total) * 100 : 0} indicatorClassName="bg-[var(--c)]" style={{ ["--c" as string]: p.color }} />
                </div>
                {cat && <span className="flex items-center gap-1.5 text-xs text-muted-foreground"><Tag className="size-3" />{cat.name}</span>}
              </Card>
            );
          })}
        </div>
      </div>

      <section>
        <h2 className="mb-1 text-base font-semibold">Categories</h2>
        <p className="mb-4 text-sm text-muted-foreground">Broad areas of life — Work, Study, Personal… Type <b>#category</b> in quick add to assign one.</p>
        <div className="flex flex-wrap gap-2">
          {categories?.map((c) => (
            <span key={c.id} className="group inline-flex items-center gap-2 rounded-lg border bg-card py-1 pr-1.5 pl-2.5 text-sm">
              <span className="size-2.5 rounded-full" style={{ background: c.color }} />{c.name}
              <button onClick={() => confirm(`Delete category “${c.name}”?`) && delCat.mutate(c.id)} className="rounded p-0.5 text-muted-foreground opacity-50 hover:bg-accent group-hover:opacity-100" aria-label={`Delete ${c.name}`}><Trash2 className="size-3.5" /></button>
            </span>
          ))}
        </div>
        <form className="mt-4 flex flex-wrap items-center gap-3" onSubmit={(e) => { e.preventDefault(); if (!catName.trim()) return; upsertCat.mutate({ name: catName.trim(), color: catColor }, { onSuccess: () => setCatName("") }); }}>
          <Input placeholder="New category" value={catName} onChange={(e) => setCatName(e.target.value)} className="h-8 w-48" />
          <ColorPicker value={catColor} onChange={setCatColor} />
          <Button size="sm" type="submit" variant="outline"><Plus />Add</Button>
        </form>
      </section>
      <ProjectDialog open={dlg.open} project={dlg.project} onOpenChange={(open) => setDlg((d) => ({ ...d, open }))} />
    </div>
  );
}
