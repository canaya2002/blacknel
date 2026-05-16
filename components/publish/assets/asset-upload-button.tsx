'use client';

import { Loader2, Upload } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useRef, useState, useTransition } from 'react';

import { uploadAssetAction } from '@/app/(app)/publish/assets/actions';
import { Button } from '@/components/ui/button';

/**
 * Direct-upload entry-point on /publish/assets. Opens a hidden
 * file input and pushes each file through `uploadAssetAction`
 * sequentially. The composer has its own `<MediaUploader />`
 * with drag-drop — this button is the lightweight counterpart
 * for the library page.
 *
 * Errors are surfaced inline (single chip beneath the button).
 * The full toast pipeline lands in Commit 21.
 */
const ACCEPT_HTML = 'image/png,image/jpeg,image/gif,image/webp,video/mp4,video/quicktime,video/webm,application/pdf';

export function AssetUploadButton(): React.ReactElement {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState<string | null>(null);

  const onFiles = (files: FileList | null): void => {
    if (!files || files.length === 0) return;
    setFeedback(null);
    const fileList: File[] = Array.from(files);
    startTransition(async () => {
      const errors: string[] = [];
      for (const file of fileList) {
        const formData = new FormData();
        formData.append('file', file);
        const result = await uploadAssetAction(null, formData);
        if (!result.ok) {
          errors.push(`${file.name}: ${result.error.message}`);
        }
      }
      if (errors.length > 0) {
        setFeedback(errors.join(' · '));
      }
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_HTML}
        multiple
        className="sr-only"
        onChange={(e) => onFiles(e.target.files)}
      />
      <Button onClick={() => inputRef.current?.click()} disabled={pending}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <Upload className="h-4 w-4" aria-hidden />
        )}
        Subir asset
      </Button>
      {feedback ? (
        <span className="max-w-md text-[11px] text-red-600" role="status">
          {feedback}
        </span>
      ) : null}
    </div>
  );
}
