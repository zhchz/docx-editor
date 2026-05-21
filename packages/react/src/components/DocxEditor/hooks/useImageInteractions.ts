/**
 * Image-interaction handlers for PagedEditor.
 *
 * Owns the resize / drag callbacks the `ImageSelectionOverlay` invokes.
 * `isImageInteractingRef` is set during a drag or resize so the selection
 * hook can suppress the deferred image-info clear (image stays selected
 * mid-drag instead of dropping out under the mouse).
 *
 * Drag move handling forks on `displayMode === 'float'` (or any of
 * square/tight/through wrap types): floating images get an EMU offset
 * update under wp:positionH/V; inline images get a PM `delete + insert`
 * pair at the drop position.
 */

import { useCallback } from 'react';

import { emuToPixels, pixelsToEmu } from '@eigenpal/docx-editor-core/utils';

import type { HiddenProseMirrorRef } from '../HiddenProseMirror';

export interface UseImageInteractionsOptions {
  pagesContainerRef: React.RefObject<HTMLDivElement | null>;
  hiddenPMRef: React.RefObject<HiddenProseMirrorRef | null>;
  zoom: number;
  isImageInteractingRef: React.MutableRefObject<boolean>;
  getPositionFromMouse: (clientX: number, clientY: number) => number | null;
}

export interface UseImageInteractionsReturn {
  handleImageResize: (pmPos: number, newWidth: number, newHeight: number) => void;
  handleImageResizeStart: () => void;
  handleImageResizeEnd: () => void;
  handleImageDragMove: (
    pmPos: number,
    targetClientX: number,
    targetClientY: number,
    pointerClientX?: number,
    pointerClientY?: number
  ) => void;
  handleImageDragStart: () => void;
  handleImageDragEnd: () => void;
}

export function useImageInteractions(
  opts: UseImageInteractionsOptions
): UseImageInteractionsReturn {
  const { pagesContainerRef, hiddenPMRef, zoom, isImageInteractingRef, getPositionFromMouse } =
    opts;

  const handleImageResize = useCallback(
    (pmPos: number, newWidth: number, newHeight: number) => {
      const view = hiddenPMRef.current?.getView();
      if (!view) return;
      try {
        const node = view.state.doc.nodeAt(pmPos);
        if (!node || node.type.name !== 'image') return;
        const tr = view.state.tr.setNodeMarkup(pmPos, undefined, {
          ...node.attrs,
          width: newWidth,
          height: newHeight,
        });
        view.dispatch(tr);
        hiddenPMRef.current?.setNodeSelection(pmPos);
      } catch {
        // Position may have shifted during resize.
      }
    },
    [hiddenPMRef]
  );

  const handleImageResizeStart = useCallback(() => {
    isImageInteractingRef.current = true;
  }, [isImageInteractingRef]);

  const handleImageResizeEnd = useCallback(() => {
    isImageInteractingRef.current = false;
  }, [isImageInteractingRef]);

  const handleImageDragMove = useCallback(
    (
      pmPos: number,
      targetClientX: number,
      targetClientY: number,
      pointerClientX = targetClientX,
      pointerClientY = targetClientY
    ) => {
      const view = hiddenPMRef.current?.getView();
      if (!view) return;
      try {
        const node = view.state.doc.nodeAt(pmPos);
        if (!node || node.type.name !== 'image') return;

        const isFloating =
          node.attrs.displayMode === 'float' ||
          (node.attrs.wrapType &&
            ['square', 'tight', 'through'].includes(node.attrs.wrapType as string));

        if (isFloating) {
          // Floating image: update wp:positionH/V offsets so the image lands
          // at the target image top-left while staying floating. Page choice
          // uses the pointer, because top-left can be outside the page when
          // the image is dragged by its center or bottom edge.
          const renderedImageEl = findRenderedFloatingImageElement(
            pagesContainerRef.current,
            pmPos
          );
          const cellContentEl = renderedImageEl?.classList.contains('layout-cell-floating-image')
            ? (renderedImageEl.closest('.layout-table-cell-content') as HTMLElement | null)
            : null;

          if (renderedImageEl && cellContentEl) {
            const currentPosition = node.attrs.position as ImagePositionAttrs | undefined;
            const cellRect = cellContentEl.getBoundingClientRect();
            const imageRect = renderedImageEl.getBoundingClientRect();
            const targetX = (targetClientX - cellRect.left) / zoom;
            const targetY = (targetClientY - cellRect.top) / zoom;
            const currentY = (imageRect.top - cellRect.top) / zoom;
            const currentOffsetY = emuToPixels(
              getNumericPosOffset(currentPosition?.vertical?.posOffset)
            );
            const paragraphBaseY =
              findCellParagraphTop(cellContentEl, pmPos, zoom) ?? currentY - currentOffsetY;

            const newPosition = {
              horizontal: {
                posOffset: pixelsToEmu(targetX),
                relativeTo: currentPosition?.horizontal?.relativeTo ?? 'column',
              },
              vertical: {
                posOffset: pixelsToEmu(targetY - paragraphBaseY),
                relativeTo: currentPosition?.vertical?.relativeTo ?? 'paragraph',
              },
            };

            const tr = view.state.tr.setNodeMarkup(pmPos, undefined, {
              ...node.attrs,
              position: newPosition,
            });
            view.dispatch(tr);
            hiddenPMRef.current?.setNodeSelection(pmPos);
            return;
          }

          const pages = pagesContainerRef.current?.querySelectorAll('.layout-page');
          if (!pages || pages.length === 0) return;

          let contentEl: HTMLElement | null = null;
          for (const page of pages) {
            const rect = page.getBoundingClientRect();
            if (pointerClientY >= rect.top && pointerClientY <= rect.bottom) {
              contentEl = page.querySelector('.layout-page-content') as HTMLElement;
              break;
            }
          }
          if (!contentEl) {
            // Below all pages — fall back to the last page's content area.
            contentEl = pages[pages.length - 1].querySelector(
              '.layout-page-content'
            ) as HTMLElement;
          }
          if (!contentEl) return;

          const contentRect = contentEl.getBoundingClientRect();
          const dropX = (targetClientX - contentRect.left) / zoom;
          const dropY = (targetClientY - contentRect.top) / zoom;
          const hOffsetEmu = pixelsToEmu(dropX);
          const vOffsetEmu = pixelsToEmu(dropY);

          const newPosition = {
            horizontal: { posOffset: hOffsetEmu, relativeTo: 'margin' },
            vertical: { posOffset: vOffsetEmu, relativeTo: 'margin' },
          };

          const tr = view.state.tr.setNodeMarkup(pmPos, undefined, {
            ...node.attrs,
            position: newPosition,
          });
          view.dispatch(tr);
          hiddenPMRef.current?.setNodeSelection(pmPos);
        } else {
          // Inline image: move to the drop text position under the pointer.
          const dropPos = getPositionFromMouse(pointerClientX, pointerClientY);
          if (dropPos === null) return;
          if (dropPos === pmPos || dropPos === pmPos + 1) return;

          let tr = view.state.tr;
          if (dropPos <= pmPos) {
            tr = tr.delete(pmPos, pmPos + node.nodeSize);
            tr = tr.insert(dropPos, node);
            hiddenPMRef.current?.setNodeSelection(dropPos);
          } else {
            tr = tr.delete(pmPos, pmPos + node.nodeSize);
            const adjusted = dropPos - node.nodeSize;
            tr = tr.insert(Math.min(adjusted, tr.doc.content.size), node);
            hiddenPMRef.current?.setNodeSelection(Math.min(adjusted, tr.doc.content.size - 1));
          }
          view.dispatch(tr);
        }
      } catch {
        // Position may have shifted between the drag's frames.
      }
    },
    [getPositionFromMouse, zoom, hiddenPMRef, pagesContainerRef]
  );

  const handleImageDragStart = useCallback(() => {
    isImageInteractingRef.current = true;
  }, [isImageInteractingRef]);

  const handleImageDragEnd = useCallback(() => {
    isImageInteractingRef.current = false;
  }, [isImageInteractingRef]);

  return {
    handleImageResize,
    handleImageResizeStart,
    handleImageResizeEnd,
    handleImageDragMove,
    handleImageDragStart,
    handleImageDragEnd,
  };
}

interface ImagePositionAttrs {
  horizontal?: { posOffset?: unknown; relativeTo?: string };
  vertical?: { posOffset?: unknown; relativeTo?: string };
}

function getNumericPosOffset(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function findRenderedFloatingImageElement(
  pagesContainer: HTMLElement | null,
  pmPos: number
): HTMLElement | null {
  if (!pagesContainer || !Number.isFinite(pmPos)) return null;
  return pagesContainer.querySelector<HTMLElement>(
    [
      `.layout-cell-floating-image[data-pm-start="${pmPos}"]`,
      `.layout-page-floating-image[data-pm-start="${pmPos}"]`,
    ].join(',')
  );
}

function findCellParagraphTop(
  cellContentEl: HTMLElement,
  pmPos: number,
  zoom: number
): number | null {
  let bestParagraph: HTMLElement | null = null;
  let bestStart = -Infinity;
  const paragraphs = cellContentEl.querySelectorAll<HTMLElement>('.layout-paragraph[data-pm-start]');

  for (const paragraph of paragraphs) {
    const start = Number(paragraph.dataset.pmStart);
    if (!Number.isFinite(start)) continue;
    const end = Number(paragraph.dataset.pmEnd);
    if (start <= pmPos && Number.isFinite(end) && pmPos <= end) {
      return elementTopRelativeTo(paragraph, cellContentEl, zoom);
    }
    if (start <= pmPos && start > bestStart) {
      bestStart = start;
      bestParagraph = paragraph;
    }
  }

  return bestParagraph ? elementTopRelativeTo(bestParagraph, cellContentEl, zoom) : null;
}

function elementTopRelativeTo(element: HTMLElement, ancestor: HTMLElement, zoom: number): number {
  const safeZoom = zoom > 0 ? zoom : 1;
  const elementRect = element.getBoundingClientRect();
  const ancestorRect = ancestor.getBoundingClientRect();
  return (elementRect.top - ancestorRect.top) / safeZoom;
}
