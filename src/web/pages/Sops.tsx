import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDate, IS_DEMO } from '../api';
import {
  Button,
  Card,
  EmptyState,
  ErrorNote,
  Modal,
  PageHeader,
  Spinner,
  statusBadge,
} from '../components';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';

interface SopDoc {
  id: string;
  title: string;
  originalFilename: string | null;
  mimeType: string | null;
  status: string;
  pageCount: number | null;
  errorText: string | null;
  createdAt: string;
  chunkCount: number;
}

interface SopDetail extends SopDoc {
  chunks: Array<{ id: string; chunkIndex: number; headingPath: string; content: string; tokenCount: number }>;
}

export default function Sops() {
  const [docs, setDocs] = useState<SopDoc[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<SopDetail | null>(null);
  const [uploading, setUploading] = useState(false);
  const [asPages, setAsPages] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setDocs(await api<SopDoc[]>('/api/sops'));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // Poll while any doc is processing.
  useEffect(() => {
    if (!docs?.some((d) => d.status === 'processing' || d.status === 'uploaded')) return;
    const t = setInterval(() => void load(), 2000);
    return () => clearInterval(t);
  }, [docs, load]);

  async function upload(files: FileList | File[]) {
    const list = [...files];
    if (list.length === 0) return;
    setUploading(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('asPages', String(asPages));
      for (const f of list) form.append('files', f);
      await api('/api/sops/upload', { method: 'POST', body: form });
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setUploading(false);
    }
  }

  async function remove(doc: SopDoc) {
    if (!window.confirm(`Delete "${doc.title}" and all its chunks? Workers will no longer get answers from it.`)) return;
    await api(`/api/sops/${doc.id}`, { method: 'DELETE' });
    await load();
  }

  return (
    <div>
      <PageHeader
        title="SOPs"
        subtitle="Upload your procedures (PDF, Word, or photos of paper SOPs). Establo answers workers only from these."
      />
      <ErrorNote error={error} />

      {IS_DEMO && (
        <Card className="badge-warning mb-5 border border-warning/25 p-4 text-sm">
          Document upload and OCR run on the real backend — this hosted demo ships with the{' '}
          {docs ? `${docs.length} ` : ''}sample SOPs below (browse their extracted chunks with
          "View text"). Clone the repo and run{' '}
          <code className="rounded bg-warning/15 px-1 font-mono">pnpm dev</code> to ingest your own.
        </Card>
      )}
      <Card
        className={`mb-5 border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? 'border-primary bg-accent' : 'border-input'
        } ${IS_DEMO ? 'hidden' : ''}`}
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            void upload(e.dataTransfer.files);
          }}
        >
          <p className="text-sm text-foreground">
            Drag &amp; drop files here, or{' '}
            <button
              className="font-medium text-primary underline"
              onClick={() => fileInput.current?.click()}
            >
              browse
            </button>
          </p>
          <p className="mt-1 text-xs text-muted-foreground">PDF · DOCX · Markdown · JPG/PNG photos</p>
          <label className="mt-3 inline-flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={asPages}
              onChange={(e) => setAsPages(e.target.checked)}
              className="rounded border-input"
            />
            Selected images are pages of ONE document (photographed paper SOP)
          </label>
          {uploading && <p className="mt-2 text-xs font-medium text-primary">Uploading…</p>}
          <input
            ref={fileInput}
            type="file"
            multiple
            accept=".pdf,.docx,.doc,.md,.txt,image/*"
            className="hidden"
            onChange={(e) => {
              if (e.target.files) void upload(e.target.files);
              e.target.value = '';
            }}
          />
        </div>
      </Card>

      <Card>
        {!docs ? (
          <Spinner />
        ) : docs.length === 0 ? (
          <EmptyState title="No SOPs yet" hint="Upload your first procedure above — or run pnpm seed for demo data." />
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="pl-5">Document</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Chunks</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {docs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="pl-5">
                    <div className="font-medium text-foreground">{d.title}</div>
                    <div className="text-xs text-muted-foreground">
                      {d.originalFilename}
                      {d.errorText && <span className="ml-2 text-destructive">{d.errorText}</span>}
                    </div>
                  </TableCell>
                  <TableCell>{statusBadge(d.status)}</TableCell>
                  <TableCell className="text-right font-mono tabular-nums text-muted-foreground">
                    {d.chunkCount}
                  </TableCell>
                  <TableCell className="font-mono tabular-nums text-muted-foreground">
                    {fmtDate(d.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        onClick={() => void api<SopDetail>(`/api/sops/${d.id}`).then(setViewing)}
                      >
                        View text
                      </Button>
                      {d.status === 'failed' && (
                        <Button
                          variant="secondary"
                          onClick={() =>
                            void api(`/api/sops/${d.id}/reingest`, { method: 'POST' }).then(load)
                          }
                        >
                          Retry
                        </Button>
                      )}
                      <Button variant="ghost" onClick={() => void remove(d)}>
                        Delete
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)} wide>
          <p className="mb-3 text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">{viewing.chunks.length}</span> chunks —
            extracted text as Establo retrieves it
          </p>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {viewing.chunks.map((c) => (
              <div key={c.id} className="rounded-md border border-border bg-muted/40 p-3">
                <div className="mb-1 text-xs font-medium text-primary">
                  {c.headingPath}{' '}
                  <span className="font-mono font-normal tabular-nums text-muted-foreground">
                    · ~{c.tokenCount} tokens
                  </span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-foreground">{c.content}</pre>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
