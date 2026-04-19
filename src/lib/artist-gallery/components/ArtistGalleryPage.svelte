<script lang="ts">
  import { onMount, tick } from "svelte";
  import { createArtistGalleryStore } from "../store.svelte.js";
  import type { ArtistEntry, ArtistSearchHit } from "../types.js";
  import ArtistLightbox from "./ArtistLightbox.svelte";
  import ColorPicker from "./ColorPicker.svelte";

  interface Props {
    manifestUrl: string;
    /** Optional integrator hook for "Insert tag into prompt" in the lightbox. */
    oninsertTag?: (tag: string) => void;
  }

  let { manifestUrl, oninsertTag }: Props = $props();

  const store = createArtistGalleryStore(manifestUrl);

  type SortField = "postCount" | "name" | "uniqueness";
  type SortDir = "asc" | "desc";
  type PageSize = 25 | 50 | 100;

  // ---------------------------------------------------------------------------
  // Uniqueness scoring
  // ---------------------------------------------------------------------------
  // Log-normal distribution centred at exp(5.5) ≈ 245 posts, sigma=1.8 in log
  // space. Artists with 50–2 000 posts score highest; mega-popular (10k+) and
  // tiny (<10) score low — the "hidden gem" sweet spot.
  function logNormalScore(x: number, mu: number, sigma: number): number {
    if (x <= 0) return 0;
    const lx = Math.log(x);
    return Math.exp(-0.5 * ((lx - mu) / sigma) ** 2);
  }

  function baseUniqueness(postCount: number): number {
    return logNormalScore(postCount, 5.5, 1.8);
  }

  let uniquenessJitter = $state<Float32Array>(new Float32Array(0));

  function generateJitter(count: number): Float32Array {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) arr[i] = 0.7 + 0.6 * Math.random();
    return arr;
  }

  function rotateUniqueness() {
    uniquenessJitter = generateJitter(allEntries.length);
    sortField = "uniqueness";
    cardAnimKey++;
    currentPage = 1;
    requestAnimationFrame(() => {
      scrollToTop();
    });
  }

  let allEntries = $state<ArtistSearchHit[]>([]);
  let allLoading = $state(false);
  let allError = $state<string | null>(null);

  let sortField = $state<SortField>("postCount");
  let sortDir = $state<SortDir>("desc");
  const PAGE_SIZES: PageSize[] = [25, 50, 100];
  let pageSize = $state<PageSize>(50);
  let currentPage = $state(1);

  let active = $state<ArtistEntry | null>(null);
  let activeIndex = $state(-1);
  let lightboxZoom = $state(1);
  let queryInput = $state("");
  let searchDebounce: number | null = null;
  let pageJumpInput = $state("");
  let infiniteScroll = $state(localStorage.getItem("infiniteScroll") === "true");
  let infiniteCount = $state(50);
  let sentinelEl = $state<HTMLDivElement | null>(null);

  type Theme = "light" | "dark" | "auto";
  let theme = $state<Theme>((localStorage.getItem("theme") as Theme) ?? "auto");
  // Logarithmic card sizing: slider is 0–100, maps to 100–400px via power curve.
  // Default 60 ≈ 230px (previous preferred size).
  const CARD_PX_MIN = 100, CARD_PX_MAX = 400;
  let cardSliderVal = $state(Number(localStorage.getItem("cardSliderVal") || "60"));
  const cardMinWidth = $derived(
    Math.round(CARD_PX_MIN * (CARD_PX_MAX / CARD_PX_MIN) ** (cardSliderVal / 100))
  );
  let systemDark = $state(window.matchMedia("(prefers-color-scheme: dark)").matches);

  // ---------------------------------------------------------------------------
  // Favourites
  // ---------------------------------------------------------------------------
  let favouritesList = $state<string[]>(JSON.parse(localStorage.getItem("favourites") || "[]"));
  const favourites = $derived(new Set(favouritesList));
  let showFavouritesOnly = $state(false);
  let cardAnimKey = $state(0);

  $effect(() => {
    localStorage.setItem("favourites", JSON.stringify(favouritesList));
  });

  function toggleFavourite(slug: string, e: MouseEvent) {
    e.stopPropagation();
    e.preventDefault();
    if (favourites.has(slug)) {
      favouritesList = favouritesList.filter(s => s !== slug);
      // also remove from all categories
      categories = categories.map(c => ({ ...c, slugs: c.slugs.filter(s => s !== slug) }));
    } else {
      favouritesList = [...favouritesList, slug];
    }
  }

  // ---------------------------------------------------------------------------
  // Favourite categories
  // ---------------------------------------------------------------------------
  type FavCategory = { id: string; name: string; color: string; slugs: string[] };

  const PRESET_COLORS = ["#818cf8","#f472b6","#34d399","#fbbf24","#60a5fa","#f87171","#a78bfa","#2dd4bf"];
  let categories = $state<FavCategory[]>(JSON.parse(localStorage.getItem("favCategories") || "[]"));
  let activeCategoryId = $state<string | null>(null);
  let showCategoryManager = $state(false);
  let showToolbar = $state(false);
  let catMenuSlug = $state<string | null>(null);
  let catMenuPos = $state({ top: 0, left: 0 });
  let newCatName = $state("");
  let newCatColor = $state(PRESET_COLORS[0]);
  let importInput = $state<HTMLInputElement | null>(null);

  $effect(() => { localStorage.setItem("favCategories", JSON.stringify(categories)); });

  function createCategory(name: string, color: string) {
    if (!name.trim()) return;
    categories = [...categories, { id: crypto.randomUUID(), name: name.trim(), color, slugs: [] }];
    newCatName = "";
  }

  function deleteCategory(id: string) {
    categories = categories.filter(c => c.id !== id);
    if (activeCategoryId === id) activeCategoryId = null;
  }

  function renameCategory(id: string, name: string) {
    if (name.trim()) categories = categories.map(c => c.id === id ? { ...c, name: name.trim() } : c);
  }

  function recolorCategory(id: string, color: string) {
    categories = categories.map(c => c.id === id ? { ...c, color } : c);
  }

  function toggleSlugInCategory(categoryId: string, slug: string) {
    categories = categories.map(c => {
      if (c.id !== categoryId) return c;
      return c.slugs.includes(slug)
        ? { ...c, slugs: c.slugs.filter(s => s !== slug) }
        : { ...c, slugs: [...c.slugs, slug] };
    });
  }

  function slugCategories(slug: string): FavCategory[] {
    return categories.filter(c => c.slugs.includes(slug));
  }

  function cardBorderInfo(slug: string): { cls: string; style: string } {
    if (copiedSlug === slug) return { cls: "border-emerald-500", style: "" };
    const cats = slugCategories(slug);
    if (cats.length > 0) return { cls: "", style: `border-color: ${cats[0].color};` };
    if (favourites.has(slug)) return { cls: "border-pink-700 hover:border-pink-500", style: "" };
    return { cls: "border-neutral-800 hover:border-indigo-500", style: "" };
  }

  function openCatMenu(slug: string, e: MouseEvent) {
    e.stopPropagation();
    if (catMenuSlug === slug) { catMenuSlug = null; return; }
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    catMenuPos = { top: rect.bottom + 4, left: rect.left };
    catMenuSlug = slug;
  }

  function closeCatMenu() { catMenuSlug = null; }

  function exportFavourites() {
    const data = JSON.stringify({ version: 1, favourites: favouritesList, categories }, null, 2);
    const blob = new Blob([data], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "anima-favourites.json";
    a.click();
    URL.revokeObjectURL(url);
  }

  function exportFavouritesTxt() {
    // Export the currently-scoped list (active category → that category's
    // slugs in order; otherwise all favourites). Artist tags are written one
    // per line with '@' prefix stripped and underscores preserved for prompt
    // pasting.
    const scope = activeCategoryId
      ? categories.find(c => c.id === activeCategoryId)?.slugs ?? []
      : favouritesList;
    const slugToTag = new Map(allEntries.map(e => [e.slug, e.tag.replace(/^@/, "")]));
    const lines = scope.map(s => slugToTag.get(s) ?? s);
    if (lines.length === 0) return;
    const filenameScope = activeCategoryId
      ? (categories.find(c => c.id === activeCategoryId)?.name ?? "category").replace(/[^a-z0-9_-]+/gi, "_")
      : "favourites";
    const blob = new Blob([lines.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `anima-${filenameScope}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function onImportFile(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const raw = JSON.parse(ev.target?.result as string);
        if (Array.isArray(raw.favourites))
          favouritesList = raw.favourites.filter((s: unknown) => typeof s === "string");
        if (Array.isArray(raw.categories))
          categories = (raw.categories as unknown[]).filter((c): c is FavCategory =>
            typeof c === "object" && c !== null &&
            typeof (c as FavCategory).id === "string" &&
            typeof (c as FavCategory).name === "string" &&
            typeof (c as FavCategory).color === "string" &&
            Array.isArray((c as FavCategory).slugs)
          );
      } catch { /* invalid JSON */ }
      (e.target as HTMLInputElement).value = "";
    };
    reader.readAsText(file);
  }

  onMount(() => {
    store.init().then(async () => {
      allLoading = true;
      allError = null;
      try {
        allEntries = await store.client.loadSearchIndex();
        uniquenessJitter = generateJitter(allEntries.length);
      } catch (err) {
        allError = err instanceof Error ? err.message : String(err);
      } finally {
        allLoading = false;
      }
    });
  });

  onMount(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => { systemDark = e.matches; };
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  });

  // Keyboard hotkeys: 4–0 snap the card-size slider to 7 evenly-spaced
  // densities (4 = biggest cards / fewest per row, 0 = smallest / most).
  // Ignored while typing in an input/textarea/contenteditable or when a
  // modifier key is held.
  const SIZE_HOTKEYS: Record<string, number> = {
    "4": 100, "5": 84, "6": 68, "7": 52, "8": 36, "9": 18, "0": 0,
  };
  onMount(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      const mapped = SIZE_HOTKEYS[e.key];
      if (mapped !== undefined) {
        cardSliderVal = mapped;
        e.preventDefault();
        return;
      }
      // Auto-focus search bar when typing a printable character
      if (e.key.length === 1 && searchInputEl) {
        searchInputEl.focus();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  let searchInputEl = $state<HTMLInputElement | null>(null);



  function onSearchInput(value: string) {
    queryInput = value;
    currentPage = 1;
    cardAnimKey++;
  }

  function goToRandomPage() {
    goToPage(Math.floor(Math.random() * totalPages) + 1);
  }

  function submitPageJump() {
    const n = parseInt(pageJumpInput, 10);
    if (!isNaN(n)) goToPage(Math.max(1, Math.min(n, totalPages)));
    pageJumpInput = "";
  }

  async function openHit(slug: string, index = -1) {
    // Open the modal immediately with data already in the search index,
    // so the image and tag are visible without waiting for the shard fetch.
    const hit = allEntries.find(e => e.slug === slug);
    if (hit && store.manifest) {
      const imageUrl = hit.hasImage && hit.imageId
        ? `${store.manifest.imageBaseUrl}/${store.manifest.releasePrefix}/images/${hit.imageId}.webp`
        : "";
      active = { tag: hit.tag, slug: hit.slug, imageId: hit.imageId, imageUrl, objectKey: "", postCount: hit.postCount, aliases: [], hasImage: hit.hasImage };
      activeIndex = index;
    }
    // Fetch full entry (for aliases) in background and update when ready.
    store.openArtist(slug).then(() => {
      if (store.activeArtist && active?.slug === slug) active = store.activeArtist;
    });
  }

  async function navigateTo(index: number) {
    const entries = visibleEntries;
    const clamped = Math.max(0, Math.min(entries.length - 1, index));
    await openHit(entries[clamped].slug, clamped);
  }

  function closeLightbox() {
    active = null;
    activeIndex = -1;
    store.closeArtist();
  }

  function thumbUrl(hit: ArtistSearchHit): string {
    if (!store.manifest || !hit.hasImage || !hit.imageId) return "";
    return `${store.manifest.imageBaseUrl}/${store.manifest.releasePrefix}/images/${hit.imageId}.webp`;
  }

  function formatCount(n: number): string {
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${(n / 1_000).toFixed(0)}k`;
    return String(n);
  }

  function displayTag(tag: string): string {
    return tag.replace(/^@/, "").replace(/_/g, " ");
  }

  let copiedSlug = $state<string | null>(null);

  async function copyTag(tag: string, slug: string) {
    const formatted = "@" + tag.replace(/^@/, "");
    await navigator.clipboard.writeText(formatted);
    copiedSlug = slug;
    window.setTimeout(() => { copiedSlug = null; }, 1500);
  }

  let scrollContainer = $state<HTMLDivElement | null>(null);
  let scrolled = $state(false);

  function scrollToTop() {
    scrollContainer?.scrollTo({ top: 0, behavior: "instant" });
    scrollContainer?.dispatchEvent(new Event("scroll"));
  }

  // Track scroll position to show/hide the mobile scroll-to-top button.
  $effect(() => {
    const el = scrollContainer;
    if (!el) return;
    const onScroll = () => { scrolled = el.scrollTop > 400; };
    el.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => el.removeEventListener("scroll", onScroll);
  });

  function goToPage(page: number) {
    currentPage = page;
    requestAnimationFrame(() => {
      scrollToTop();
    });
  }

  function setSort(field: SortField) {
    if (field === "uniqueness" && sortField !== "uniqueness") {
      rotateUniqueness();
      return;
    }
    sortField = field;
    cardAnimKey++;
    currentPage = 1;
    requestAnimationFrame(() => {
      scrollToTop();
    });
  }

  function setDir(dir: SortDir) {
    sortDir = dir;
    cardAnimKey++;
    currentPage = 1;
    requestAnimationFrame(() => {
      scrollToTop();
    });
  }

  function setPageSize(size: PageSize) {
    const firstIndex = (safePage - 1) * pageSize;
    pageSize = size;
    currentPage = Math.max(1, Math.floor(firstIndex / size) + 1);
    requestAnimationFrame(() => {
      scrollContainer?.dispatchEvent(new Event("scroll"));
    });
  }

  const sortedEntries = $derived.by(() => {
    let entries: typeof allEntries;
    if (sortField === "uniqueness") {
      const jitter = uniquenessJitter;
      entries = [...allEntries]
        .map((e, i) => ({ e, score: baseUniqueness(e.postCount) * (jitter[i] ?? 1) }))
        .sort((a, b) => b.score - a.score)
        .map((x) => x.e);
    } else {
      const dir = sortDir === "asc" ? 1 : -1;
      entries = [...allEntries].sort((a, b) =>
        sortField === "name"
          ? a.slug.localeCompare(b.slug) * dir
          : (a.postCount - b.postCount) * dir,
      );
    }
    const q = queryInput.trim().toLowerCase();
    if (q) {
      entries = entries.filter(e =>
        e.slug.includes(q) || e.tag.toLowerCase().replace(/_/g, " ").includes(q)
      );
    }
    if (activeCategoryId) {
      const catSlugs = new Set(categories.find(c => c.id === activeCategoryId)?.slugs ?? []);
      return entries.filter(e => catSlugs.has(e.slug));
    }
    if (showFavouritesOnly) {
      return entries.filter(e => favourites.has(e.slug));
    }
    return entries;
  });

  const totalPages = $derived(Math.max(1, Math.ceil(sortedEntries.length / pageSize)));
  const safePage = $derived(Math.min(currentPage, totalPages));
  const pageEntries = $derived(
    sortedEntries.slice((safePage - 1) * pageSize, safePage * pageSize),
  );
  const visibleEntries = $derived(
    infiniteScroll ? sortedEntries.slice(0, infiniteCount) : pageEntries
  );

  // ---------------------------------------------------------------------------
  // Image preload cache — keep a sliding window of ±4 pages in memory
  // ---------------------------------------------------------------------------
  const _preloadCache = new Map<string, HTMLImageElement>();

  const _currentYear = new Date().getFullYear();
  const copyrightYear = _currentYear > 2026 ? `2026\u2013${_currentYear}` : '2026';

  const _preloadUrls = $derived.by(() => {
    if (!store.manifest) return [] as string[];
    const { imageBaseUrl, releasePrefix } = store.manifest;
    const urls: string[] = [];
    if (infiniteScroll) {
      // Preload visible entries + one batch ahead so images are in cache before they scroll in
      const lookahead = Math.min(infiniteCount + pageSize, sortedEntries.length);
      for (let i = 0; i < lookahead; i++) {
        const hit = sortedEntries[i];
        if (hit?.hasImage && hit.imageId)
          urls.push(`${imageBaseUrl}/${releasePrefix}/images/${hit.imageId}.webp`);
      }
    } else {
      const start = Math.max(1, safePage - 4);
      const end = Math.min(totalPages, safePage + 1);
      for (let p = start; p <= end; p++) {
        for (const hit of sortedEntries.slice((p - 1) * pageSize, p * pageSize)) {
          if (hit.hasImage && hit.imageId)
            urls.push(`${imageBaseUrl}/${releasePrefix}/images/${hit.imageId}.webp`);
        }
      }
    }
    return urls;
  });

  $effect(() => {
    const urlSet = new Set(_preloadUrls);
    for (const url of urlSet) {
      if (!_preloadCache.has(url)) {
        const img = new Image();
        img.src = url;
        _preloadCache.set(url, img);
      }
    }
    for (const url of _preloadCache.keys()) {
      if (!urlSet.has(url)) _preloadCache.delete(url);
    }
  });

  let showGenInfo = $state(false);

  // Reset infinite scroll position when the entry list changes (sort/filter/search)
  $effect(() => {
    sortedEntries;
    infiniteCount = pageSize;
  });

  // IntersectionObserver — loads next page worth of cards as user nears the bottom
  $effect(() => {
    const el = sentinelEl;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting && infiniteCount < sortedEntries.length) {
        infiniteCount = Math.min(infiniteCount + pageSize, sortedEntries.length);
      }
    }, { rootMargin: "400px" });
    obs.observe(el);
    return () => obs.disconnect();
  });

  $effect(() => {
    localStorage.setItem("theme", theme);
    localStorage.setItem("cardSliderVal", String(cardSliderVal));
    localStorage.setItem("infiniteScroll", String(infiniteScroll));
    const isLight = theme === "light" || (theme === "auto" && !systemDark);
    document.documentElement.classList.toggle("light", isLight);
  });
</script>

<svelte:document onclick={closeCatMenu} />

<div class="flex h-full w-full flex-col overflow-hidden bg-neutral-950 text-neutral-100">
  <header class="relative flex-none border-b border-neutral-800 bg-neutral-900/60 px-4 py-3">
    <!-- Top bar (promo + theme toggle): in-flow on small screens, absolute on md+ -->
    <div class="mb-2 flex items-center justify-between gap-2 md:mb-0">
      <!-- MooshieUI promo -->
      <a
        href="https://github.com/Mooshieblob1/MooshieUI"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-xs text-neutral-400 transition-colors hover:border-indigo-500 hover:text-neutral-200 md:absolute md:left-4 md:top-3"
        title="MooshieUI — a beginner-friendly ComfyUI front-end"
      >
        <svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/></svg>
        <span>Enjoy this? Try <span class="text-indigo-400">MooshieUI</span> to generate AI art!</span>
      </a>
    <!-- Theme toggle -->
    <div class="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1 md:absolute md:right-4 md:top-3">
      <button type="button" class="rounded px-2 py-0.5 text-xs transition-colors {theme === 'auto' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}" onclick={() => (theme = 'auto')} title="Auto (system)">⚙</button>
      <button type="button" class="rounded px-2 py-0.5 text-xs transition-colors {theme === 'light' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}" onclick={() => (theme = 'light')} title="Light">☀</button>
      <button type="button" class="rounded px-2 py-0.5 text-xs transition-colors {theme === 'dark' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}" onclick={() => (theme = 'dark')} title="Dark">🌙</button>
    </div>
    </div>
    <div class="flex flex-col items-center gap-3">
      <div class="order-2 lg:order-none flex flex-col items-center text-center">
        <h1 class="text-[1.265rem] font-semibold">Anima Style Gallery</h1>
        <p class="text-xs text-neutral-500">
          created by <a
            href="https://github.com/Mooshieblob1"
            target="_blank"
            rel="noopener noreferrer"
            class="text-indigo-400 hover:text-indigo-300 transition-colors"
          >Mooshieblob</a>
        </p>
        <p class="text-xs text-emerald-500 font-medium">Free forever</p>
        <p class="text-xs text-neutral-500">
          {#if store.manifest}
            {store.manifest.artistsWithImage.toLocaleString()} artists ·
            Anima Preview 2 · release {store.manifest.releasePrefix} ·
            <button type="button" onclick={() => (showGenInfo = true)} class="inline-flex items-center gap-1 rounded border border-neutral-700 bg-neutral-800/60 px-1.5 py-0.5 text-[11px] text-neutral-400 transition-colors hover:border-indigo-500 hover:text-neutral-200">
              <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" aria-hidden="true"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1Zm0 12.5a5.5 5.5 0 1 1 0-11 5.5 5.5 0 0 1 0 11ZM7.25 5h1.5v1.5h-1.5V5Zm0 3h1.5v3h-1.5V8Z"/></svg>
              Gen Params
            </button>
          {:else if store.manifestError}
            <span class="text-red-400">failed to load: {store.manifestError}</span>
          {:else}
            loading manifest…
          {/if}
        </p>
      </div>

      <!-- Search -->
      <div class="order-1 lg:order-none relative w-full max-w-sm">
        <input
          bind:this={searchInputEl}
          type="search"
          placeholder="Search artist tag… (just start typing)"
          value={queryInput}
          oninput={(e) => onSearchInput(e.currentTarget.value)}
          class="w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2 text-sm text-neutral-100 placeholder-neutral-500 focus:border-indigo-500 focus:outline-none"
        />
        {#if queryInput.trim() && sortedEntries.length === 0 && !allLoading}
          <span class="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-neutral-500">no results</span>
        {/if}
      </div>
    </div>

    <!-- Sort + page size toolbar -->
    {#if store.manifest}
      <div class="mt-3 flex justify-center">
        <button
          type="button"
          onclick={() => (showToolbar = !showToolbar)}
          aria-expanded={showToolbar}
          aria-controls="gallery-toolbar"
          class="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-1 text-xs text-neutral-400 transition-colors hover:border-indigo-500 hover:text-neutral-200"
          title="Toggle sort & filter options"
        >
          <span aria-hidden="true" class="flex flex-col gap-0.75">
            <span class="block h-0.5 w-4 bg-current"></span>
            <span class="block h-0.5 w-4 bg-current"></span>
            <span class="block h-0.5 w-4 bg-current"></span>
          </span>
          <span>{showToolbar ? 'Hide' : 'Sort & filter'}</span>
        </button>
      </div>
      {#if showToolbar}
      <div id="gallery-toolbar" class="mt-2 flex flex-wrap items-center justify-center gap-2">
        <div class="flex items-center gap-1.5 rounded-lg border border-neutral-800 bg-neutral-900/50 px-2 py-1" title="Card size (hotkeys: 4–0)">
          <span class="text-xs text-neutral-500">Size:</span>
          <input type="range" min="0" max="100" step="1" bind:value={cardSliderVal} class="w-20 accent-indigo-500" />
        </div>
        <button
          type="button"
          onclick={() => { showFavouritesOnly = !showFavouritesOnly; activeCategoryId = null; cardAnimKey++; }}
          class="flex items-center gap-1.5 rounded-lg border bg-neutral-900/50 px-2 py-1 text-xs transition-colors {showFavouritesOnly ? 'border-pink-600/60 text-pink-400 hover:text-pink-300' : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}"
        >♥ Favourites{#if favourites.size > 0} ({favourites.size}){/if}</button>
        {#each categories as cat (cat.id)}
          <button
            type="button"
            onclick={() => { activeCategoryId = activeCategoryId === cat.id ? null : cat.id; showFavouritesOnly = false; cardAnimKey++; }}
            style="{activeCategoryId === cat.id ? `border-color: ${cat.color}; background-color: ${cat.color}18;` : ''}"
            class="flex items-center gap-1.5 rounded-lg border bg-neutral-900/50 px-2 py-1 text-xs transition-colors {activeCategoryId === cat.id ? 'text-white' : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}"
          >
            <span class="inline-block h-2 w-2 shrink-0 rounded-full" style="background-color: {cat.color};"></span>
            {cat.name}{#if cat.slugs.length > 0}<span class="{activeCategoryId === cat.id ? 'text-white/60' : 'text-neutral-500'}"> ({cat.slugs.length})</span>{/if}
          </button>
        {/each}
        <button
          type="button"
          onclick={() => showCategoryManager = true}
          class="flex items-center gap-1 rounded-lg border border-neutral-800 bg-neutral-900/50 px-2 py-1 text-xs text-neutral-400 transition-colors hover:text-neutral-200"
          title="Manage categories & export/import"
        >⊞ Categories</button>
        <div class="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1">
          <span class="px-1.5 text-xs text-neutral-500">Sort:</span>
          <button
            type="button"
            class="rounded px-2 py-0.5 text-xs transition-colors {sortField === 'postCount' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
            onclick={() => setSort('postCount')}
          >
            Post Count
          </button>
          <button
            type="button"
            class="rounded px-2 py-0.5 text-xs transition-colors {sortField === 'name' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
            onclick={() => setSort('name')}
          >
            Name
          </button>
          <button
            type="button"
            class="rounded px-2 py-0.5 text-xs transition-colors {sortField === 'uniqueness' ? 'bg-amber-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
            onclick={() => setSort('uniqueness')}
            title="Surfaces hidden gems: artists with a distinctive style not yet overexposed"
          >
            Trending
          </button>
          <div class="mx-1 h-3 w-px shrink-0 bg-neutral-700"></div>
          {#if sortField === 'uniqueness'}
            <button
              type="button"
              class="rounded px-2 py-0.5 text-xs text-amber-400 transition-colors hover:text-amber-200"
              onclick={rotateUniqueness}
              title="Reshuffle the uniqueness ranking to discover a fresh set of hidden gems"
            >
              ↻ Rotate
            </button>
          {:else}
            <button
              type="button"
              class="rounded px-2 py-0.5 text-xs transition-colors {sortDir === 'desc' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
              onclick={() => setDir('desc')}
              title="Descending"
            >
              ↓ Desc
            </button>
            <button
              type="button"
              class="rounded px-2 py-0.5 text-xs transition-colors {sortDir === 'asc' ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
              onclick={() => setDir('asc')}
              title="Ascending"
            >
              ↑ Asc
            </button>
          {/if}
        </div>

        {#if !infiniteScroll}
        <div class="flex items-center gap-0.5 rounded-lg border border-neutral-800 bg-neutral-900/50 p-1">
          <span class="px-1.5 text-xs text-neutral-500">Per page:</span>
          {#each PAGE_SIZES as size}
            <button
              type="button"
              class="rounded px-2 py-0.5 text-xs transition-colors {pageSize === size ? 'bg-indigo-600 text-white' : 'text-neutral-400 hover:text-neutral-200'}"
              onclick={() => setPageSize(size)}
            >
              {size}
            </button>
          {/each}
        </div>
        {/if}
        <label class="flex cursor-pointer items-center gap-1.5 rounded-lg border bg-neutral-900/50 px-2 py-1 text-xs transition-colors {infiniteScroll ? 'border-indigo-600/40 text-indigo-400' : 'border-neutral-800 text-neutral-400 hover:text-neutral-200'}">
          <input type="checkbox" bind:checked={infiniteScroll} onclick={() => { currentPage = 1; infiniteCount = pageSize; }} class="accent-indigo-500" />
          Infinite scroll
        </label>
      </div>
      {/if}
    {/if}
  </header>

  <div class="flex-1 overflow-y-auto overflow-x-hidden" bind:this={scrollContainer}>
    {#if allError}
      <div class="p-8 text-center text-sm text-red-400">
        Failed to load artists: {allError}
      </div>
    {:else if allLoading}
      <div class="p-8 text-center text-sm text-neutral-500">loading artists…</div>
    {:else}
      <p class="pt-3 text-center text-xs text-neutral-500">Right click a card to copy a tag</p>
      {#if totalPages > 1 && !infiniteScroll}
        <div class="flex flex-wrap items-center justify-center gap-2 border-b border-neutral-800/60 px-4 py-2">
          <button
            type="button"
            class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1 text-sm text-neutral-300 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage <= 1}
            onclick={() => goToPage(safePage - 1)}
          >
            ← Prev
          </button>
          <span class="text-sm text-neutral-400">
            Page {safePage} of {totalPages}
            <span class="text-neutral-600">·</span>
            {sortedEntries.length.toLocaleString()} artists
          </span>
          <button
            type="button"
            class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1 text-sm text-neutral-300 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage >= totalPages}
            onclick={() => goToPage(safePage + 1)}
          >
            Next →
          </button>
          <button
            type="button"
            class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1 text-sm text-neutral-300 transition-colors hover:border-amber-500"
            onclick={goToRandomPage}
            title="Go to a random page"
          >
            ⚄ Random
          </button>
          <form onsubmit={(e) => { e.preventDefault(); submitPageJump(); }} class="flex items-center gap-1">
            <input
              type="number"
              min="1"
              max={totalPages}
              placeholder="page #"
              bind:value={pageJumpInput}
              class="w-16 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-center text-sm text-neutral-100 placeholder-neutral-600 focus:border-indigo-500 focus:outline-none"
            />
            <button type="submit" class="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-300 transition-colors hover:border-indigo-500">Go</button>
          </form>
        </div>
      {/if}
      {#key cardAnimKey}
      <div class="grid gap-3 p-4" style="grid-template-columns: repeat(auto-fill, minmax({cardMinWidth}px, 1fr))">
        {#each visibleEntries as hit, i (hit.slug)}
          {@const url = thumbUrl(hit)}
          {@const rank = (safePage - 1) * pageSize + i + 1}
          {@const border = cardBorderInfo(hit.slug)}
          {@const catDots = slugCategories(hit.slug)}
          <div
            role="button"
            tabindex="0"
            style="{border.style}animation-delay: {Math.min(i * 30, 450)}ms"
            class="card-slide group flex flex-col items-stretch overflow-hidden rounded-lg border bg-neutral-900 text-left transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-indigo-500 {border.cls}"
            onclick={() => openHit(hit.slug, i)}
            onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHit(hit.slug, i); } }}
            oncontextmenu={(e) => { e.preventDefault(); void copyTag(hit.tag, hit.slug); }}
            title="{hit.tag} · Right-click to copy tag"
          >
            <div class="relative aspect-3/4 w-full bg-neutral-800">
              {#if url}
                <img
                  src={url}
                  alt={hit.tag}
                  loading="lazy"
                  decoding="async"
                  class="h-full w-full object-cover"
                />
              {:else}
                <div class="flex h-full w-full items-center justify-center text-xs text-neutral-500">
                  no preview
                </div>
              {/if}
              {#if sortField === 'uniqueness'}
                <div class="absolute left-1 top-1 rounded bg-amber-600/90 px-1 py-0.5 text-[10px] font-mono font-bold leading-none text-white">
                  #{rank}
                </div>
              {/if}
              <button
                type="button"
                onclick={(e) => toggleFavourite(hit.slug, e)}
                class="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900/70 text-sm leading-none transition-colors hover:bg-neutral-900 {favourites.has(hit.slug) ? 'text-pink-500' : 'text-neutral-500 hover:text-pink-400'}"
                aria-label="{favourites.has(hit.slug) ? 'Unfavourite' : 'Favourite'} {hit.tag}"
                title="{favourites.has(hit.slug) ? 'Unfavourite' : 'Favourite'}"
              >{favourites.has(hit.slug) ? '♥' : '♡'}</button>
              {#if favourites.has(hit.slug)}
                <button
                  type="button"
                  onclick={(e) => openCatMenu(hit.slug, e)}
                  class="absolute left-1 bottom-1 flex items-center gap-0.5 rounded bg-neutral-900/70 px-1 py-0.5 leading-none transition-colors hover:bg-neutral-900 {catDots.length > 0 ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}"
                  aria-label="Assign to category"
                  title="Assign to category"
                >
                  {#if catDots.length > 0}
                    {#each catDots.slice(0, 3) as cat}
                      <span class="inline-block h-2 w-2 shrink-0 rounded-full" style="background-color: {cat.color};"></span>
                    {/each}
                    {#if catDots.length > 3}<span class="text-[9px] text-neutral-400">+{catDots.length - 3}</span>{/if}
                  {:else}
                    <svg viewBox="0 0 16 16" width="9" height="9" fill="currentColor" class="text-neutral-400"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2z"/></svg>
                  {/if}
                </button>
              {/if}
              <button
                type="button"
                onclick={(e) => { e.stopPropagation(); void copyTag(hit.tag, hit.slug); }}
                class="absolute right-1 bottom-1 flex h-6 w-6 items-center justify-center rounded-full bg-neutral-900/70 text-neutral-500 leading-none opacity-0 transition-opacity group-hover:opacity-100 hover:bg-neutral-900 hover:text-neutral-200"
                aria-label="Copy tag {hit.tag}"
                title="Copy tag"
              >
                {#if copiedSlug === hit.slug}
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor" class="text-emerald-400"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>
                {:else}
                  <svg viewBox="0 0 16 16" width="11" height="11" fill="currentColor"><path d="M0 6.75C0 5.784.784 5 1.75 5h1.5a.75.75 0 0 1 0 1.5h-1.5a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-1.5a.75.75 0 0 1 1.5 0v1.5A1.75 1.75 0 0 1 9.25 16h-7.5A1.75 1.75 0 0 1 0 14.25Z"/><path d="M5 1.75C5 .784 5.784 0 6.75 0h7.5C15.216 0 16 .784 16 1.75v7.5A1.75 1.75 0 0 1 14.25 11h-7.5A1.75 1.75 0 0 1 5 9.25Zm1.75-.25a.25.25 0 0 0-.25.25v7.5c0 .138.112.25.25.25h7.5a.25.25 0 0 0 .25-.25v-7.5a.25.25 0 0 0-.25-.25Z"/></svg>
                {/if}
              </button>
            </div>
            <div class="flex items-center justify-between gap-2 px-2 py-1.5">
              <span class="truncate text-sm text-red-400">{displayTag(hit.tag)}</span>
              <span class="shrink-0 text-xs text-neutral-500">{formatCount(hit.postCount)}</span>
            </div>
          </div>
        {/each}
      </div>
      {/key}

      {#if infiniteScroll}
        <div bind:this={sentinelEl} class="py-6 text-center text-xs text-neutral-600">
          {#if infiniteCount < sortedEntries.length}Loading more…{:else}All {sortedEntries.length.toLocaleString()} artists shown{/if}
        </div>
      {/if}

      <!-- Pagination -->
      {#if totalPages > 1 && !infiniteScroll}
        <div class="flex flex-wrap items-center justify-center gap-2 px-4 py-4">
          <button
            type="button"
            class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage <= 1}
            onclick={() => goToPage(safePage - 1)}
          >
            ← Prev
          </button>
          <span class="text-sm text-neutral-400">
            Page {safePage} of {totalPages}
            <span class="text-neutral-600">·</span>
            {sortedEntries.length.toLocaleString()} artists
          </span>
          <button
            type="button"
            class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={safePage >= totalPages}
            onclick={() => goToPage(safePage + 1)}
          >
            Next →
          </button>
          <button
            type="button"
            class="rounded-md border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-300 transition-colors hover:border-amber-500"
            onclick={goToRandomPage}
            title="Go to a random page"
          >
            ⚄ Random
          </button>
          <form onsubmit={(e) => { e.preventDefault(); submitPageJump(); }} class="flex items-center gap-1">
            <input
              type="number"
              min="1"
              max={totalPages}
              placeholder="page #"
              bind:value={pageJumpInput}
              class="w-16 rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-center text-sm text-neutral-100 placeholder-neutral-600 focus:border-indigo-500 focus:outline-none"
            />
            <button type="submit" class="rounded-md border border-neutral-700 bg-neutral-800 px-2 py-1 text-sm text-neutral-300 transition-colors hover:border-indigo-500">Go</button>
          </form>
        </div>
      {/if}
    {/if}
  </div>

  <footer class="flex-none border-t border-neutral-800 bg-neutral-900/60 px-4 py-2">
    <div class="flex flex-wrap items-center justify-center gap-3 text-xs text-neutral-500">
      <a
        href="https://github.com/Mooshieblob1"
        target="_blank"
        rel="noopener noreferrer"
        class="flex items-center gap-1.5 text-neutral-400 transition-colors hover:text-neutral-200"
        aria-label="Mooshieblob1 on GitHub"
      >
        <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor" aria-hidden="true">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"/>
        </svg>
        Mooshieblob1
      </a>
      <span>·</span>
      <span>© {copyrightYear} Mooshieblob</span>
      <span>·</span>
      <span>created with <a
        href="https://gpu.garden"
        target="_blank"
        rel="noopener noreferrer"
        class="text-indigo-400 transition-colors hover:text-indigo-300"
      >fartcore</a></span>
    </div>
  </footer>

  <!-- Mobile/tablet scroll-to-top floating button -->
  <button
    type="button"
    onclick={scrollToTop}
    aria-label="Scroll to top"
    title="Scroll to top"
    class="lg:hidden fixed bottom-4 right-4 z-40 flex h-11 w-11 items-center justify-center rounded-full border border-neutral-700 bg-neutral-900/90 text-neutral-200 shadow-lg backdrop-blur transition-all hover:border-indigo-500 hover:text-white {scrolled ? 'opacity-100 translate-y-0 pointer-events-auto' : 'opacity-0 translate-y-2 pointer-events-none'}"
  >
    <svg viewBox="0 0 20 20" width="18" height="18" fill="currentColor" aria-hidden="true">
      <path d="M10 4l-6 6h4v6h4v-6h4z"/>
    </svg>
  </button>
</div>

{#if catMenuSlug}
  <div
    role="menu"
    tabindex="-1"
    class="fixed z-40 min-w-44 rounded-lg border border-neutral-700 bg-neutral-900 py-1 shadow-xl"
    style="top: {catMenuPos.top}px; left: {catMenuPos.left}px;"
    onclick={(e) => e.stopPropagation()}
    onkeydown={(e) => { if (e.key === 'Escape') catMenuSlug = null; }}
  >
    {#if categories.length === 0}
      <p class="px-3 py-1.5 text-xs italic text-neutral-500">No categories yet.</p>
    {:else}
      {#each categories as cat (cat.id)}
        {@const inCat = cat.slugs.includes(catMenuSlug)}
        <button
          type="button"
          onclick={() => toggleSlugInCategory(cat.id, catMenuSlug!)}
          class="flex w-full items-center gap-2 px-3 py-1.5 text-xs transition-colors hover:bg-neutral-800 {inCat ? 'text-neutral-200' : 'text-neutral-400'}"
        >
          <span
            class="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 transition-colors {inCat ? 'border-transparent' : 'border-neutral-600'}"
            style="{inCat ? `background-color: ${cat.color};` : ''}"
          ></span>
          <span class="flex-1 text-left">{cat.name}</span>
          {#if inCat}<svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor" class="shrink-0 text-emerald-400"><path d="M13.78 4.22a.75.75 0 0 1 0 1.06l-7.25 7.25a.75.75 0 0 1-1.06 0L2.22 9.28a.75.75 0 0 1 1.06-1.06L6 10.94l6.72-6.72a.75.75 0 0 1 1.06 0z"/></svg>{/if}
        </button>
      {/each}
      <div class="mx-2 my-1 h-px bg-neutral-800"></div>
    {/if}
    <button
      type="button"
      onclick={() => { showCategoryManager = true; catMenuSlug = null; }}
      class="flex w-full items-center gap-1.5 px-3 py-1.5 text-xs text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
    >
      <svg viewBox="0 0 16 16" width="10" height="10" fill="currentColor"><path d="M7.75 2a.75.75 0 0 1 .75.75V7h4.25a.75.75 0 0 1 0 1.5H8.5v4.25a.75.75 0 0 1-1.5 0V8.5H2.75a.75.75 0 0 1 0-1.5H7V2.75A.75.75 0 0 1 7.75 2z"/></svg>
      Manage categories
    </button>
  </div>
{/if}

{#if showCategoryManager}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Manage favourite categories"
  >
    <button type="button" class="absolute inset-0 h-full w-full cursor-default" aria-label="Close" onclick={() => showCategoryManager = false}></button>
    <div class="relative z-10 mx-4 flex w-full max-w-md flex-col rounded-xl border border-neutral-700 bg-neutral-900 shadow-2xl" style="max-height: 85vh;">
      <div class="flex shrink-0 items-center justify-between border-b border-neutral-800 px-4 py-3">
        <h2 class="text-sm font-semibold text-neutral-100">Favourite Categories</h2>
        <button type="button" onclick={() => showCategoryManager = false} class="text-lg leading-none text-neutral-500 transition-colors hover:text-neutral-200" aria-label="Close">✕</button>
      </div>
      <div class="flex-1 overflow-y-auto p-4 space-y-2">
        {#if categories.length === 0}
          <p class="py-6 text-center text-sm text-neutral-500">No categories yet — create one below.</p>
        {/if}
        {#each categories as cat (cat.id)}
          <div class="flex items-center gap-2 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2">
            <ColorPicker value={cat.color} onchange={(c) => recolorCategory(cat.id, c)} />
            <input
              type="text"
              value={cat.name}
              onchange={(e) => renameCategory(cat.id, e.currentTarget.value)}
              class="min-w-0 flex-1 bg-transparent text-sm text-neutral-200 focus:outline-none"
              placeholder="Category name"
            />
            <span class="shrink-0 text-xs text-neutral-500">{cat.slugs.length} artist{cat.slugs.length !== 1 ? 's' : ''}</span>
            <button
              type="button"
              onclick={() => deleteCategory(cat.id)}
              class="shrink-0 text-sm leading-none text-neutral-600 transition-colors hover:text-red-400"
              title="Delete category"
              aria-label="Delete {cat.name}"
            >✕</button>
          </div>
        {/each}
      </div>
      <div class="shrink-0 border-t border-neutral-800 p-4">
        <form onsubmit={(e) => { e.preventDefault(); createCategory(newCatName, newCatColor); }} class="flex items-center gap-2">
          <ColorPicker value={newCatColor} onchange={(c) => newCatColor = c} />
          <input
            type="text"
            bind:value={newCatName}
            placeholder="New category name"
            class="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-sm text-neutral-100 placeholder-neutral-500 focus:border-indigo-500 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!newCatName.trim()}
            class="shrink-0 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-40"
          >Add</button>
        </form>
      </div>
      <div class="shrink-0 flex gap-2 border-t border-neutral-800 px-4 py-3">
        <button
          type="button"
          onclick={exportFavourites}
          class="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500 hover:bg-neutral-700"
          title="Export favourites and categories as JSON"
        >↑ Export JSON</button>
        <button
          type="button"
          onclick={exportFavouritesTxt}
          class="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500 hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={(activeCategoryId ? (categories.find(c => c.id === activeCategoryId)?.slugs.length ?? 0) : favouritesList.length) === 0}
          title={activeCategoryId ? "Export this category's artist names as a plain text list" : "Export favourite artist names as a plain text list"}
        >↑ Export .txt</button>
        <button
          type="button"
          onclick={() => importInput?.click()}
          class="flex-1 rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-1.5 text-xs text-neutral-200 transition-colors hover:border-indigo-500 hover:bg-neutral-700"
          title="Import favourites and categories from JSON"
        >↓ Import JSON</button>
      </div>
    </div>
  </div>
{/if}

<input bind:this={importInput} type="file" accept=".json" class="hidden" aria-hidden="true" onchange={onImportFile} />

{#if active}
  <ArtistLightbox
    entry={active}
    onclose={closeLightbox}
    {oninsertTag}
    bind:zoom={lightboxZoom}
    onprev={activeIndex > 0 ? () => navigateTo(activeIndex - 1) : undefined}
    onnext={activeIndex >= 0 && activeIndex < pageEntries.length - 1 ? () => navigateTo(activeIndex + 1) : undefined}
  />
{/if}

{#if showGenInfo}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
    aria-label="Generation parameters"
  >
    <button type="button" class="absolute inset-0 h-full w-full cursor-default" aria-label="Close" onclick={() => (showGenInfo = false)}></button>
    <div class="relative z-10 w-full max-w-lg rounded-xl border border-neutral-700 bg-neutral-900 p-6 shadow-2xl mx-4 max-h-[90vh] overflow-y-auto">
      <button
        type="button"
        onclick={() => (showGenInfo = false)}
        class="absolute right-4 top-4 text-neutral-500 hover:text-neutral-200 transition-colors text-lg leading-none"
        aria-label="Close"
      >✕</button>
      <h2 class="mb-4 text-base font-semibold text-neutral-100">How preview images are generated</h2>
      <p class="mb-4 text-xs text-neutral-500">Each artist card image is generated using the artist's tag as the sole prompt token. No additional positive or negative prompts are used — this isolates each artist's raw style.</p>

      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Model Stack</h3>
      <table class="mb-4 w-full text-xs">
        <tbody>
          <tr class="border-b border-neutral-800">
            <td class="py-1.5 pr-3 text-neutral-500">UNet</td>
            <td class="py-1.5 font-mono text-neutral-200">anima-preview2.safetensors</td>
          </tr>
          <tr class="border-b border-neutral-800">
            <td class="py-1.5 pr-3 text-neutral-500">Text encoder</td>
            <td class="py-1.5 font-mono text-neutral-200">qwen_3_06b_base.safetensors <span class="text-neutral-500">(wan)</span></td>
          </tr>
          <tr>
            <td class="py-1.5 pr-3 text-neutral-500">VAE</td>
            <td class="py-1.5 font-mono text-neutral-200">qwen_image_vae.safetensors</td>
          </tr>
        </tbody>
      </table>

      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Sampler Settings</h3>
      <table class="mb-4 w-full text-xs">
        <tbody>
          <tr class="border-b border-neutral-800">
            <td class="py-1.5 pr-3 text-neutral-500">Sampler</td>
            <td class="py-1.5 font-mono text-neutral-200">er_sde</td>
          </tr>
          <tr class="border-b border-neutral-800">
            <td class="py-1.5 pr-3 text-neutral-500">Scheduler</td>
            <td class="py-1.5 font-mono text-neutral-200">sgm_uniform</td>
          </tr>
          <tr class="border-b border-neutral-800">
            <td class="py-1.5 pr-3 text-neutral-500">Steps</td>
            <td class="py-1.5 font-mono text-neutral-200">30</td>
          </tr>
          <tr class="border-b border-neutral-800">
            <td class="py-1.5 pr-3 text-neutral-500">CFG</td>
            <td class="py-1.5 font-mono text-neutral-200">4.0</td>
          </tr>
          <tr class="border-b border-neutral-800">
            <td class="py-1.5 pr-3 text-neutral-500">Seed</td>
            <td class="py-1.5 font-mono text-neutral-200">42 <span class="text-neutral-500">(fixed)</span></td>
          </tr>
          <tr>
            <td class="py-1.5 pr-3 text-neutral-500">Resolution</td>
            <td class="py-1.5 font-mono text-neutral-200">896 × 1152</td>
          </tr>
        </tbody>
      </table>

      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Output</h3>
      <table class="mb-4 w-full text-xs">
        <tbody>
          <tr class="border-b border-neutral-800">
            <td class="py-1.5 pr-3 text-neutral-500">Format</td>
            <td class="py-1.5 font-mono text-neutral-200">WEBP</td>
          </tr>
          <tr>
            <td class="py-1.5 pr-3 text-neutral-500">Thumbnail size</td>
            <td class="py-1.5 font-mono text-neutral-200">540 × 720</td>
          </tr>
        </tbody>
      </table>

      <h3 class="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-400">Prompts</h3>
      <div class="space-y-2 text-xs">
        <div>
          <div class="mb-1 text-neutral-500">Positive:</div>
          <div class="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 font-mono text-neutral-200 leading-relaxed">{`{artist_tag}`}, year 2025, newest, masterpiece, best quality, score_9, score_8, highres, safe, 1girl, hatsune miku, from above, sitting, bench, school, serafuku, fence, long sleeves, outdoors, hamburger, eating, blue sky, plant</div>
          <div class="mt-1 text-neutral-600">The artist's tag is prepended as the first token.</div>
        </div>
        <div>
          <div class="mb-1 text-neutral-500">Negative:</div>
          <div class="rounded border border-neutral-700 bg-neutral-800 px-3 py-2 font-mono text-neutral-300 leading-relaxed">worst quality, low quality, score_1, score_2, score_3, blurry, jpeg artifacts, sepia, sensitive, nsfw, explicit</div>
        </div>
      </div>
    </div>
  </div>
{/if}

<style>
  @keyframes card-slide-in {
    from {
      opacity: 0;
      transform: translateX(60px) scale(0.93);
      filter: blur(3px);
    }
    to {
      opacity: 1;
      transform: translateX(0) scale(1);
      filter: blur(0);
    }
  }

  :global(.card-slide) {
    animation: card-slide-in 0.55s cubic-bezier(0.22, 1.4, 0.64, 1) both;
  }
</style>
