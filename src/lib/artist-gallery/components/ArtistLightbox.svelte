<script lang="ts">
  import { fade } from "svelte/transition";
  import { formatCopiedTag } from "../tags.js";
  import type { ArtistEntry } from "../types.js";

  interface Props {
    entry: ArtistEntry;
    onclose: () => void;
    /** Optional integrator hook: "Insert tag into prompt" action. */
    oninsertTag?: (tag: string) => void;
    onprev?: () => void;
    onnext?: () => void;
    /** Whether the open artist has a second preview to flip to. */
    canFlip?: boolean;
    /** Flip the open artist's preview image (p1 ↔ p2). */
    onflip?: () => void;
    zoom?: number;
  }

  let { entry, onclose, oninsertTag, onprev, onnext, canFlip = false, onflip, zoom = $bindable(1) }: Props = $props();

  /** Current variant inferred from the trailing -pN suffix of the imageId. */
  const currentVariant = $derived(entry.imageId.endsWith("-p2") ? 2 : 1);

  /**
   * Svelte action: play the 3D card-rotate flip when the variant changes for
   * the *same* artist. Navigating to a different artist (slug change) does not
   * animate, so prev/next stays a clean cross-fade.
   */
  function flipImage(node: HTMLElement, params: { slug: string; variant: number }) {
    let prev = params;
    return {
      update(next: { slug: string; variant: number }) {
        if (next.slug === prev.slug && next.variant !== prev.variant) {
          node.animate(
            [
              { transform: "rotateY(90deg)", opacity: 0.15, offset: 0 },
              { transform: "rotateY(0deg)", opacity: 1, offset: 1 },
            ],
            { duration: 450, easing: "cubic-bezier(0.22, 1, 0.36, 1)" }
          );
        }
        prev = next;
      },
    };
  }

  // CSS `zoom` (unlike transform: scale) participates in layout, so the
  // enlarged image grows the scrollable column and the info bar reflows to sit
  // directly below it — never overlapped. Click toggles between fit and 1.8×.
  function cycleZoom(e: MouseEvent) {
    e.stopPropagation();
    zoom = zoom > 1 ? 1 : 1.8;
  }

  function displayTag(tag: string): string {
    return tag.replace(/^@/, "").replace(/_/g, " ");
  }

  function displayPostCount(entry: ArtistEntry): string {
    return entry.belowThreshold ? "≤50" : entry.postCount.toLocaleString();
  }

  function onBackdropKey(e: KeyboardEvent) {
    if (e.key === "Escape") onclose();
    if (e.key === "ArrowLeft") { e.preventDefault(); onprev?.(); }
    if (e.key === "ArrowRight") { e.preventDefault(); onnext?.(); }
  }

  async function copyTag() {
    try {
      await navigator.clipboard.writeText(formatCopiedTag(entry.tag));
    } catch {
      // no-op; clipboard may be unavailable in some contexts
    }
  }
</script>

<svelte:window onkeydown={onBackdropKey} />

<div
  transition:fade={{ duration: 200 }}
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
  role="dialog"
  aria-modal="true"
  aria-label={`Artist preview: ${entry.tag}`}
>
  <button
    type="button"
    class="absolute inset-0 h-full w-full cursor-default"
    aria-label="Close"
    onclick={onclose}
  ></button>

  {#if onprev}
    <button
      type="button"
      onclick={onprev}
      class="absolute left-3 top-1/2 z-20 -translate-y-1/2 flex items-center justify-center rounded-full border-2 border-neutral-400 bg-neutral-800 text-white shadow-lg transition-colors hover:border-indigo-400 hover:bg-neutral-700 focus:outline-none"
      style="width: clamp(2.5rem, 2.5vw, 4rem); height: clamp(2.5rem, 2.5vw, 4rem); font-size: clamp(1.1rem, 1.4vw, 1.8rem);"
      aria-label="Previous artist"
    >
      ←
    </button>
  {/if}
  {#if onnext}
    <button
      type="button"
      onclick={onnext}
      class="absolute right-3 top-1/2 z-20 -translate-y-1/2 flex items-center justify-center rounded-full border-2 border-neutral-400 bg-neutral-800 text-white shadow-lg transition-colors hover:border-indigo-400 hover:bg-neutral-700 focus:outline-none"
      style="width: clamp(2.5rem, 2.5vw, 4rem); height: clamp(2.5rem, 2.5vw, 4rem); font-size: clamp(1.1rem, 1.4vw, 1.8rem);"
      aria-label="Next artist"
    >
      →
    </button>
  {/if}

  <div
    transition:fade={{ duration: 150 }}
    class="relative z-10 flex w-auto max-w-[92vw] max-h-[92vh] flex-col items-center gap-3 overflow-auto p-4">
    {#if entry.hasImage && entry.imageUrl}
      <button
        type="button"
        onclick={cycleZoom}
        style="zoom: {zoom}; transition: zoom 0.4s cubic-bezier(0.34, 1.56, 0.64, 1);"
        class="block shrink-0 perspective-[600px] {zoom > 1 ? 'cursor-zoom-out' : 'cursor-zoom-in'} focus:outline-none"
        aria-label="{zoom > 1 ? 'Zoom out' : 'Zoom in'}"
        title="{zoom > 1 ? 'Click to zoom out' : 'Click to zoom in'}"
      >
        <img
          src={entry.imageUrl}
          alt={entry.tag}
          use:flipImage={{ slug: entry.slug, variant: currentVariant }}
          class="block max-h-[78vh] max-w-[88vw] w-auto rounded-lg border border-neutral-800 object-contain shadow-2xl backface-hidden"
        />
      </button>
    {:else}
      <div
        class="flex aspect-3/4 h-[70vh] shrink-0 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-900 text-sm text-neutral-500"
      >
        no preview available
      </div>
    {/if}

    <div
      class="w-full shrink-0 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-neutral-800 bg-neutral-900/90 px-4 py-3"
    >
      <div class="min-w-0 flex-1">
        <a
          href="https://danbooru.donmai.us/artists/show_or_new?name={encodeURIComponent(entry.tag.replace(/^@/, ''))}"
          target="_blank"
          rel="noopener noreferrer"
          class="block truncate text-base font-medium text-red-400 hover:underline"
        >
          {displayTag(entry.tag)}
        </a>
        <div class="mt-0.5 text-xs text-neutral-500">
          {displayPostCount(entry)} posts
          {#if entry.aliases.length > 0}
            · aliases: {entry.aliases.map((a) => a.replace(/^@/, "")).join(", ")}
          {/if}
        </div>
      </div>
      <div class="flex shrink-0 gap-2">
        {#if canFlip}
          <button
            type="button"
            class="flex items-center gap-1.5 rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500 hover:bg-neutral-700"
            onclick={onflip}
            title="Switch preview image"
            aria-label="Switch preview image"
          >
            <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true">
              <path d="M4 4h7V2l3 3-3 3V6H4V4zm8 8H5v2l-3-3 3-3v2h7v2z" />
            </svg>
            Image {currentVariant}
          </button>
        {/if}
        <button
          type="button"
          class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500 hover:bg-neutral-700"
          onclick={copyTag}
        >
          Copy tag
        </button>
        {#if oninsertTag}
          <button
            type="button"
            class="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500"
            onclick={() => oninsertTag?.(formatCopiedTag(entry.tag))}
          >
            Insert into prompt
          </button>
        {/if}
        <button
          type="button"
          class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-neutral-500"
          onclick={onclose}
        >
          Close
        </button>
      </div>
    </div>
  </div>
</div>
