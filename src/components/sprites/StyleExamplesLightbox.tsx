'use client';

import dynamic from 'next/dynamic';
import type { GenerationStyle } from '@/lib/styleRegistry';

// Dynamic import keeps YARL out of the initial bundle — loads on first lightbox open.
const Lightbox = dynamic(() => import('yet-another-react-lightbox'), {
  ssr: false,
  loading: () => null,
});

// YARL's base styles (only loaded when this component loads).
import 'yet-another-react-lightbox/styles.css';

interface Props {
  style: GenerationStyle | null;
  onClose: () => void;
  onUseStyle: () => void;
}

/**
 * Custom slide renderer that preserves `image-rendering: pixelated`
 * and constrains size to viewport with `object-fit: contain`.
 *
 * YARL's default <img> tag doesn't apply pixelated rendering, which
 * would defeat the point of pixel-art examples. This renderer is the
 * critical piece that makes the lightbox work for our use case.
 */
function PixelArtSlide({ slide }: { slide: { src: string; alt?: string } }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '100%',
        height: '100%',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={slide.src}
        alt={slide.alt ?? 'Style example'}
        draggable={false}
        style={{
          imageRendering: 'pixelated',
          maxWidth: '90vw',
          maxHeight: '80vh',
          objectFit: 'contain',
        }}
      />
    </div>
  );
}

export function StyleExamplesLightbox({ style, onClose, onUseStyle }: Props) {
  // Only render when a style with examples is provided.
  if (!style || !style.examplePaths || style.examplePaths.length === 0) {
    return null;
  }

  const slides = style.examplePaths.map((path, i) => ({
    src: path,
    alt: `${style.label} example ${i + 1}`,
  }));

  return (
    <Lightbox
      open={true}
      close={onClose}
      slides={slides}
      render={{ slide: PixelArtSlide }}
      animation={{ fade: 220, swipe: 300 }}
      controller={{ closeOnBackdropClick: true }}
      carousel={{ finite: true, preload: 2 }}
      toolbar={{
        buttons: [
          <button
            key="use-style"
            type="button"
            onClick={onUseStyle}
            className="px-3 py-1.5 mr-2 rounded-md bg-amber-400 text-black font-semibold text-sm hover:bg-amber-300 transition-colors"
            aria-label={`Use ${style.label} style`}
          >
            Use this style →
          </button>,
          'close',
        ],
      }}
      labels={{
        Previous: 'Previous example',
        Next: 'Next example',
        Close: 'Close lightbox',
      }}
      styles={{
        container: { backgroundColor: 'rgba(10, 10, 12, 0.94)' },
      }}
    />
  );
}
