import Link from 'next/link';
import { EDITOR_RESIZE_LINK, EDITOR_RESIZE_WAY_OUT } from '@/lib/editorConstants';

/**
 * An editor refusal as it reads, with "Resize page" as a link to /resize
 * when the words end with /editor's way out (DESIGN room 2026-11-15-126,
 * item 2; HQ 2026-11-17-062). Any other message shows as it is. On a touch
 * screen the link takes taps 13 px above and below its line, about 44 px in
 * all, without moving the lines around it.
 */
export default function EditorRefusalText({ message }: { message: string }) {
  if (!message.endsWith(EDITOR_RESIZE_WAY_OUT)) return <>{message}</>;
  const at = message.length - EDITOR_RESIZE_WAY_OUT.length + EDITOR_RESIZE_WAY_OUT.indexOf(EDITOR_RESIZE_LINK.label);
  return (
    <>
      {message.slice(0, at)}
      <Link href={EDITOR_RESIZE_LINK.href} className="relative inline-block underline hover:text-text-primary pointer-coarse:after:absolute pointer-coarse:after:inset-x-0 pointer-coarse:after:-inset-y-[13px] pointer-coarse:after:content-['']">
        {EDITOR_RESIZE_LINK.label}
      </Link>
      {message.slice(at + EDITOR_RESIZE_LINK.label.length)}
    </>
  );
}
