import { useEffect, useRef, useState } from "react";
import {
  getImages,
  getJournal,
  getRequestedImages,
  imageUrl,
  type Journal,
  type Message,
  type Portrait,
  portraitUrl,
  type RequestedImage,
  type RequestedImages,
  requestedImageUrl,
  type SceneImageInfo,
  type SceneImages,
  takeImageFailure,
} from "./api";
import { Zoomable } from "./zoom";

// Often enough to feel prompt, as an image takes many seconds anyway.
export const IMAGE_CHECK_MS = 2000;

export function SceneImage({ id, image, onLoad }: { id: string; image: SceneImageInfo; onLoad?: () => void }) {
  return (
    <figure className="plate">
      <Zoomable lazy src={imageUrl(id, image)} alt={image.caption ? `Scene Image: ${image.caption}` : "Scene Image"} onLoad={onLoad} />
      {image.caption && <figcaption aria-hidden="true">{image.caption}</figcaption>}
    </figure>
  );
}

const requestedAlt = ({ caption }: RequestedImage) => `Picture: ${caption}`;

export function RequestedPicture({ id, image }: { id: string; image: RequestedImage }) {
  return (
    <figure className="plate">
      <Zoomable lazy src={requestedImageUrl(id, image)} alt={requestedAlt(image)} />
      <figcaption aria-hidden="true">{image.caption}</figcaption>
    </figure>
  );
}

type Shown = "scene" | "requested" | "portrait";

/**
 * A story's pictures and its Journal, which holds the portraits. They draw in the background, so this looks for them
 * apart from the Turn, for as long as any are on the way. `latestId` is the Message a portrait updated now shows under.
 */
export function useStoryPictures(id: string, latestId: number | undefined, onFailure: (failure: { error: string; words: string }) => void) {
  const [images, setImages] = useState<SceneImages>({ images: [], pending: false, session: 0 });
  const [requested, setRequested] = useState<RequestedImages>({ images: [], drawing: 0 });
  const [journal, setJournal] = useState<Journal>();
  // Portraits updated while the page is open, under the latest Message then. Only in memory, so a refresh clears them.
  const [updated, setUpdated] = useState<{ portrait: Portrait; messageId: number }[]>([]);
  const lastJournal = useRef<Journal>(undefined);
  // Pictures each list held when first fetched. They stay folded, and only ones drawn later open by themselves.
  const loaded = useRef<Partial<Record<Shown, Set<number>>>>({});
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const gone = useRef(false);
  // Whether pictures were drawing at the last check, so the Journal is read again once they stop.
  const drew = useRef(false);
  const latest = useRef(latestId);
  latest.current = latestId;
  const failed = useRef(onFailure);
  failed.current = onFailure;

  function takeJournal(next: Journal) {
    loaded.current.portrait ??= new Set(next.portraits.map(({ id }) => id));
    const before = lastJournal.current;
    lastJournal.current = next;
    const messageId = latest.current;
    const redrawn = next.portraits.filter(
      (portrait) => (before?.portraits.find(({ id }) => id === portrait.id)?.redraws ?? portrait.redraws) < portrait.redraws,
    );
    if (messageId !== undefined && redrawn.length > 0) setUpdated((shown) => [...shown, ...redrawn.map((portrait) => ({ portrait, messageId }))]);
    setJournal(next);
  }

  const rereadJournal = () => getJournal(id).then(takeJournal, () => {});

  function check() {
    clearTimeout(timer.current);
    Promise.all([getImages(id), getRequestedImages(id)]).then(
      ([next, asked]) => {
        loaded.current.scene ??= new Set(next.images.map(({ messageId }) => messageId));
        loaded.current.requested ??= new Set(asked.images.map(({ ref }) => ref));
        setImages(next);
        setRequested(asked);
        if (next.pending && !gone.current) {
          drew.current = true;
          timer.current = setTimeout(check, IMAGE_CHECK_MS);
        } else {
          // Once, when drawing stops, for the portraits just drawn. Only then, as this holds the whole Full Log.
          if (drew.current) rereadJournal();
          drew.current = false;
          // Not on the way out, as nothing would be left to tell the player.
          if (gone.current) return;
          takeImageFailure(id).then(
            (failure) => failure && failed.current(failure),
            () => {},
          );
        }
      },
      () => {},
    );
  }

  useEffect(() => {
    gone.current = false;
    // At once, not after the pictures, which can take minutes, so the left page fills as the story opens.
    rereadJournal();
    check();
    return () => {
      gone.current = true;
      clearTimeout(timer.current);
    };
  }, [id]);

  return {
    images,
    requested,
    journal,
    updated,
    /** Whether the picture was drawn after the page first looked, so it may open by itself. */
    isNew: (list: Shown, key: number) => !loaded.current[list]?.has(key),
    check,
    rereadJournal,
    /** Changes the height of the story, so the Turn's scroll has to fit again. */
    count: images.images.length + requested.images.length + (journal?.portraits.length ?? 0) + updated.length,
  };
}

export type StoryPictures = ReturnType<typeof useStoryPictures>;

type InlineProps = { id: string; message: Message; pictures: StoryPictures; openNew: boolean; refit: () => void };

/** Pictures the player asked for, which have no other place in the story. */
export function RequestedRows({ id, message, pictures, openNew, refit }: InlineProps) {
  return pictures.requested.images
    .filter(({ messageId }) => messageId === message.id)
    .map((image) => (
      <details key={image.ref} className="inline-image requested" open={openNew && pictures.isNew("requested", image.ref)} onToggle={refit}>
        <summary>Picture: {image.caption}</summary>
        <Zoomable lazy src={requestedImageUrl(id, image)} alt={requestedAlt(image)} onLoad={refit} />
      </details>
    ));
}

/** Folded in the story under the response they came with. */
export function InlineImages(props: InlineProps & { pc: string }) {
  const { id, message, pictures, openNew, refit, pc } = props;
  const image = pictures.images.images.find(({ messageId }) => messageId === message.id);
  return (
    <>
      {image && (
        <details className="inline-image" open={openNew && pictures.isNew("scene", image.messageId)} onToggle={refit}>
          <summary>Picture{image.caption && `: ${image.caption}`}</summary>
          {/* Only an open row loads its picture, and only then is its height known. */}
          <SceneImage id={id} image={image} onLoad={refit} />
        </details>
      )}
      {(pictures.journal?.portraits ?? [])
        .filter(({ npc, messageId }) => npc && messageId === message.id)
        .map((portrait) => (
          <details key={portrait.id} className="inline-image" open={openNew && pictures.isNew("portrait", portrait.id)} onToggle={refit}>
            <summary>Portrait: {portrait.npc}</summary>
            <Zoomable className="portrait" lazy src={portraitUrl(id, portrait)} alt={portrait.npc!} onLoad={refit} />
          </details>
        ))}
      {pictures.updated
        .filter(({ messageId }) => messageId === message.id)
        .map(({ portrait }) => (
          <details key={`${portrait.id}/${portrait.redraws}`} className="inline-image" open={openNew} onToggle={refit}>
            <summary>Portrait updated: {portrait.npc ?? pc}</summary>
            <Zoomable className="portrait" lazy src={portraitUrl(id, portrait)} alt={portrait.npc ?? pc} onLoad={refit} />
          </details>
        ))}
      <RequestedRows {...props} />
    </>
  );
}
