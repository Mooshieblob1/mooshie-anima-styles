import { createArtistGalleryClient } from "./client.js";
import type {
  ArtistEntry,
  ArtistGalleryClient,
  ArtistManifest,
  ArtistSearchHit,
} from "./types.js";

export class ArtistGalleryStore {
  readonly client: ArtistGalleryClient;

  manifest = $state<ArtistManifest | null>(null);
  manifestError = $state<string | null>(null);
  manifestLoading = $state(false);

  query = $state("");
  results = $state<ArtistSearchHit[]>([]);
  searchLoading = $state(false);

  activeArtist = $state<ArtistEntry | null>(null);
  activeLoading = $state(false);

  private searchSeq = 0;

  constructor(manifestUrl: string) {
    this.client = createArtistGalleryClient({ manifestUrl });
  }

  async init(): Promise<void> {
    if (this.manifest || this.manifestLoading) return;
    this.manifestLoading = true;
    this.manifestError = null;
    try {
      this.manifest = await this.client.loadManifest();
      this.client.loadSearchIndex().catch((err) => {
        console.error("artist-gallery: search index load failed", err);
      });
    } catch (err) {
      this.manifestError = err instanceof Error ? err.message : String(err);
    } finally {
      this.manifestLoading = false;
    }
  }

  async setQuery(text: string): Promise<void> {
    this.query = text;
    const seq = ++this.searchSeq;
    if (!text.trim()) {
      this.results = [];
      this.searchLoading = false;
      return;
    }
    this.searchLoading = true;
    try {
      const hits = await this.client.search(text, { limit: 50 });
      if (seq === this.searchSeq) {
        this.results = hits;
      }
    } catch (err) {
      console.error("artist-gallery: search failed", err);
      if (seq === this.searchSeq) this.results = [];
    } finally {
      if (seq === this.searchSeq) this.searchLoading = false;
    }
  }

  async openArtist(slugOrTag: string): Promise<void> {
    this.activeLoading = true;
    try {
      this.activeArtist = await this.client.getArtist(slugOrTag);
    } catch (err) {
      console.error("artist-gallery: openArtist failed", err);
      this.activeArtist = null;
    } finally {
      this.activeLoading = false;
    }
  }

  closeArtist(): void {
    this.activeArtist = null;
  }
}

const stores = new Map<string, ArtistGalleryStore>();
export function createArtistGalleryStore(manifestUrl: string): ArtistGalleryStore {
  const existing = stores.get(manifestUrl);
  if (existing) return existing;
  const created = new ArtistGalleryStore(manifestUrl);
  stores.set(manifestUrl, created);
  return created;
}
