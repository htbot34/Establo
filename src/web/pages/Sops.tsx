import { useCallback, useEffect, useRef, useState } from 'react';
import { api, fmtDate } from '../api';
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

      <Card
        className={`mb-5 border-2 border-dashed p-8 text-center transition-colors ${
          dragOver ? 'border-green-700 bg-green-50' : 'border-stone-300'
        }`}
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
          <p className="text-sm text-stone-600">
            Drag & drop files here, or{' '}
            <button
              className="font-medium text-green-800 underline"
              onClick={() => fileInput.current?.click()}
            >
              browse
            </button>
          </p>
          <p className="mt-1 text-xs text-stone-400">PDF · DOCX · Markdown · JPG/PNG photos</p>
          <label className="mt-3 inline-flex items-center gap-2 text-xs text-stone-600">
            <input
              type="checkbox"
              checked={asPages}
              onChange={(e) => setAsPages(e.target.checked)}
              className="rounded border-stone-300"
            />
            Selected images are pages of ONE document (photographed paper SOP)
          </label>
          {uploading && <p className="mt-2 text-xs font-medium text-green-800">Uploading…</p>}
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-stone-200 text-left text-xs uppercase tracking-wide text-stone-400">
                <th className="px-5 py-3 font-medium">Document</th>
                <th className="px-3 py-3 font-medium">Status</th>
                <th className="px-3 py-3 font-medium">Chunks</th>
                <th className="px-3 py-3 font-medium">Uploaded</th>
                <th className="px-3 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-stone-100">
              {docs.map((d) => (
                <tr key={d.id} className="hover:bg-stone-50">
                  <td className="px-5 py-3">
                    <div className="font-medium text-stone-800">{d.title}</div>
                    <div className="text-xs text-stone-400">
                      {d.originalFilename}
                      {d.errorText && <span className="ml-2 text-red-600">{d.errorText}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-3">{statusBadge(d.status)}</td>
                  <td className="px-3 py-3 text-stone-600">{d.chunkCount}</td>
                  <td className="px-3 py-3 text-stone-500">{fmtDate(d.createdAt)}</td>
                  <td className="px-3 py-3 text-right">
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
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {viewing && (
        <Modal title={viewing.title} onClose={() => setViewing(null)} wide>
          <p className="mb-3 text-xs text-stone-400">
            {viewing.chunks.length} chunks · extracted text as Establo retrieves it
          </p>
          <div className="max-h-[60vh] space-y-3 overflow-y-auto">
            {viewing.chunks.map((c) => (
              <div key={c.id} className="rounded-lg border border-stone-200 bg-stone-50 p-3">
                <div className="mb-1 text-xs font-semibold text-green-800">
                  {c.headingPath} <span className="font-normal text-stone-400">· ~{c.tokenCount} tokens</span>
                </div>
                <pre className="whitespace-pre-wrap font-sans text-xs text-stone-700">{c.content}</pre>
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
