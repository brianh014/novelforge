import { useEffect, useRef, useState } from "react";
import { deleteImage, type Gallery as GalleryContent, type GalleryImage, getGallery } from "./api";
import { BookTabs, DeleteDialog, Sheet } from "./menu";
import { IMAGE_CHECK_MS } from "./story-pictures";
import { RedrawableImage } from "./zoom";

/** The server sends each kind in its order, with the PC first, so a section only keeps it. */
/** `wide` shows the section in the 16:9 its pictures are drawn in, rather than cropped square. */
const SECTIONS: { name: string; kinds: GalleryImage["kind"][]; deletable?: boolean; wide?: boolean }[] = [
  { name: "Cover", kinds: ["cover"] },
  { name: "Characters", kinds: ["portrait"] },
  { name: "Scenes", kinds: ["scene", "requested"], deletable: true, wide: true },
];

export function Gallery({ id }: { id: string }) {
  const [gallery, setGallery] = useState<GalleryContent>();
  const [redraws, setRedraws] = useState(0);
  const [loadError, setLoadError] = useState("");
  const [deleting, setDeleting] = useState<GalleryImage>();
  const loaded = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const reload = () => setRedraws((count) => count + 1);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    let leaving = false;
    const load = () =>
      getGallery(id).then(
        (gallery) => {
          // A look begun before a delete mustn't bring its image back as a broken link.
          if (leaving) return;
          setGallery(gallery);
          loaded.current = true;
          if (gallery.pending) timer = setTimeout(load, IMAGE_CHECK_MS);
        },
        (failure: Error) => {
          // A failed look for a finished Redraw mustn't take away a Gallery already on the page.
          if (!loaded.current) setLoadError(failure.message);
        },
      );
    load();
    return () => {
      leaving = true;
      clearTimeout(timer);
    };
  }, [id, redraws]);

  return (
    <Sheet
      rail={
        <h1 className="big" ref={heading} tabIndex={-1}>
          Gallery
        </h1>
      }
      tabs={<BookTabs id={id} current="Gallery" />}
    >
      {loadError && (
        <p role="alert" className="error">
          {loadError}
        </p>
      )}
      {gallery && gallery.images.length === 0 && <p className="muted">No pictures yet.</p>}
      {SECTIONS.map(({ name, kinds, deletable, wide }) => {
        const images = gallery?.images.filter(({ kind }) => kinds.includes(kind)) ?? [];
        return (
          images.length > 0 && (
            <section key={name} className="gallery-section">
              <h2>{name}</h2>
              <ul className={wide ? "gallery wide" : "gallery"}>
                {images.map((image) => (
                  <li key={`${image.kind}${image.ref}`}>
                    <RedrawableImage
                      id={id}
                      image={image}
                      alt={image.label || "Scene Image"}
                      canRedraw={gallery!.canRedraw}
                      onRedrawn={reload}
                      // Only these have a prompt the text model writes from the story, as a Scene Image's comes from its Turn.
                      canUpdate={image.kind === "cover" || image.kind === "portrait"}
                      original={gallery!.images.find(({ kind, ref }) => kind === "original" && ref === image.ref && image.kind === "portrait")}
                      onDelete={deletable ? () => setDeleting(image) : undefined}
                    />
                    <span>{image.label}</span>
                    {image.redrawing && <span className="waiting">Redrawing…</span>}
                    {image.failure && <span className="error">Redraw failed</span>}
                  </li>
                ))}
              </ul>
            </section>
          )
        );
      })}
      {deleting && (
        <DeleteDialog
          name="this image"
          warning="This permanently deletes the image, and a Revert won't bring it back. The story stays as it is."
          onDelete={() => deleteImage(id, deleting)}
          onClose={() => {
            setDeleting(undefined);
            // Whatever the answer was, as a refusal can mean this page is behind.
            reload();
          }}
          onDeleted={() => {
            // The button that opened the dialog goes with the image, and focus must not fall back to the page.
            heading.current!.focus();
            // Again, as Escape can close the dialog before the delete has finished.
            reload();
          }}
        />
      )}
    </Sheet>
  );
}
